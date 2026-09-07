import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const SUPABASE_URL = "https://dgoyfhjhaztxppkeympd.supabase.co";
const SUPABASE_KEY = "sb_publishable_awV5ijRj4tQH4j23ps7bIQ_JXUdjRzg";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  user: null,
  players: [],
  courses: [],
  holes: new Map(),
  activeRound: null,
  admin: false,
  adminEditor: null,
  publication: { day1:false, day2:false, day3:false, overall:false },
  photoCategory: 'day1',
  photos: []
};

const $ = (id) => document.getElementById(id);

function setMessage(el, text, type = '') {
  el.textContent = text || '';
  el.className = `message ${type}`;
}

function courseHandicap(index, course) {
  return Math.round(index * (Number(course.slope) / 113) + (Number(course.course_rating) - Number(course.par)));
}

function strokesOnHole(courseHcp, strokeIndex) {
  if (courseHcp >= 0) {
    const base = Math.floor(courseHcp / 18);
    const extra = courseHcp % 18;
    return base + (strokeIndex <= extra ? 1 : 0);
  }
  const abs = Math.abs(courseHcp);
  const base = Math.floor(abs / 18);
  const extra = abs % 18;
  return -(base + (strokeIndex > 18 - extra ? 1 : 0));
}

function stableford(gross, par, strokes) {
  if (!gross || gross < 1) return 0;
  return Math.max(0, 2 + Number(par) - (Number(gross) - Number(strokes)));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

async function ensureAnonymousSession() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) {
    state.user = sessionData.session.user;
    return;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error('Anonieme login staat nog niet aan in Supabase.');
  state.user = data.user;
}

async function loadReferenceData() {
  const [playersRes, coursesRes, holesRes] = await Promise.all([
    supabase.from('players').select('*').order('name'),
    supabase.from('courses').select('*').order('day'),
    supabase.from('holes').select('*').order('course_id').order('hole')
  ]);
  if (playersRes.error) throw playersRes.error;
  if (coursesRes.error) throw coursesRes.error;
  if (holesRes.error) throw holesRes.error;

  state.players = playersRes.data;
  state.courses = coursesRes.data;
  state.holes.clear();
  for (const hole of holesRes.data) {
    if (!state.holes.has(hole.course_id)) state.holes.set(hole.course_id, []);
    state.holes.get(hole.course_id).push(hole);
  }

  $('playerSelect').innerHTML = state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('photoPlayerSelect').innerHTML = state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('courseSelect').innerHTML = state.courses.map(c => `<option value="${c.id}">Dag ${c.day} - ${esc(c.name)}</option>`).join('');
  $('adminCourseFilter').innerHTML = '<option value="all">Alle dagen</option>' + state.courses.map(c => `<option value="${c.id}">Dag ${c.day} - ${esc(c.short_name || c.name)}</option>`).join('');
  updateCourseInfo();
}

function updateCourseInfo() {
  const course = state.courses.find(c => c.id === $('courseSelect').value);
  if (!course) return;
  $('courseInfo').textContent = `Heren geel · Par ${course.par} · CR ${Number(course.course_rating).toFixed(1).replace('.', ',')} · Slope ${course.slope} · ${Number(course.length_m).toLocaleString('nl-NL')} m`;
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'photos') loadPhotos();
  if (name === 'admin' && state.admin) loadAdminCards();
}

async function openPlayerRound() {
  const playerId = $('playerSelect').value;
  const courseId = $('courseSelect').value;
  const raw = $('handicapInput').value.replace(',', '.');
  const handicapIndex = Number(raw);

  if (!Number.isFinite(handicapIndex) || handicapIndex < -10 || handicapIndex > 54) {
    setMessage($('setupMessage'), 'Vul een geldige Handicap Index in.', 'error');
    return;
  }

  setMessage($('setupMessage'), 'Scorekaart openen...');
  const { data, error } = await supabase.rpc('start_round', {
    p_player_id: playerId,
    p_course_id: courseId,
    p_handicap_index: handicapIndex
  });

  if (error) {
    setMessage($('setupMessage'), error.message, 'error');
    return;
  }

  const roundId = data;
  await loadRound(roundId, false);
  setMessage($('setupMessage'), '');
}

async function loadRound(roundId, adminMode = false) {
  const { data: round, error } = await supabase
    .from('rounds')
    .select('*, players(name), courses(*)')
    .eq('id', roundId)
    .single();
  if (error) throw error;

  const { data: scores, error: scoreError } = await supabase
    .from('scores')
    .select('*')
    .eq('round_id', roundId)
    .order('hole');
  if (scoreError) throw scoreError;

  const scoreMap = new Map(scores.map(s => [Number(s.hole), s]));
  round.scoreMap = scoreMap;

  if (adminMode) {
    state.adminEditor = round;
    renderAdminEditor();
  } else {
    state.activeRound = round;
    renderPlayerRound();
  }
}

function renderPlayerRound() {
  const r = state.activeRound;
  const course = r.courses;
  const holes = state.holes.get(r.course_id) || [];
  $('roundMeta').textContent = `Dag ${course.day} · ${course.name}`;
  $('roundTitle').textContent = r.players.name;
  $('roundHcp').textContent = `Handicap Index ${Number(r.handicap_index).toFixed(1).replace('.', ',')} · Baanhandicap ${r.course_handicap}`;
  $('scoreCardPanel').classList.remove('hidden');

  const editable = r.status === 'in_progress';
  $('submitRoundBtn').disabled = !editable;

  $('holesGrid').innerHTML = holes.map(h => {
    const saved = r.scoreMap.get(Number(h.hole));
    const strokes = strokesOnHole(Number(r.course_handicap), Number(h.stroke_index));
    const pts = saved?.points ?? 0;
    return `
      <article class="hole-card" data-hole="${h.hole}">
        <div class="hole-top">
          <strong>Hole ${h.hole}</strong>
          <span>Par ${h.par} · SI ${h.stroke_index}</span>
        </div>
        <div class="hole-sub">Slagen mee: ${strokes >= 0 ? '+' + strokes : strokes}</div>
        <div class="score-control">
          <button type="button" class="minus" ${editable ? '' : 'disabled'}>−</button>
          <input class="gross" type="number" inputmode="numeric" min="1" max="20" value="${saved?.gross ?? ''}" placeholder="-" ${editable ? '' : 'disabled'}>
          <button type="button" class="plus" ${editable ? '' : 'disabled'}>+</button>
        </div>
        <div class="hole-points">${saved?.gross ? `${pts} punt${pts === 1 ? '' : 'en'}` : '0 punten'}</div>
      </article>`;
  }).join('');

  attachScoreControls($('holesGrid'), r, false);
  updateRoundSummary(r);
  setMessage($('roundMessage'), editable ? 'Scores worden direct opgeslagen.' : 'Deze kaart is ingeleverd en kan alleen door de wedstrijdleiding worden gewijzigd.');
}

function updateRoundSummary(round) {
  $('sumPoints').textContent = round.stableford_total ?? 0;
  $('sumGross').textContent = round.gross_total ?? 0;
  $('sumHoles').textContent = `${round.holes_filled ?? 0}/18`;
}

function attachScoreControls(container, round, adminMode) {
  container.querySelectorAll('.hole-card').forEach(card => {
    const holeNo = Number(card.dataset.hole);
    const input = card.querySelector('.gross');
    const ptsEl = card.querySelector('.hole-points');
    const hole = (state.holes.get(round.course_id) || []).find(h => Number(h.hole) === holeNo);
    const strokes = strokesOnHole(Number(round.course_handicap), Number(hole.stroke_index));

    const save = async () => {
      const value = input.value === '' ? null : Math.max(1, Math.min(20, Number(input.value)));
      if (value === null) {
        const existing = round.scoreMap.get(holeNo);
        if (existing) {
          const { error } = await supabase.from('scores').delete().eq('round_id', round.id).eq('hole', holeNo);
          if (error) throw error;
          round.scoreMap.delete(holeNo);
        }
      } else {
        input.value = value;
        const points = stableford(value, hole.par, strokes);
        const { data, error } = await supabase.from('scores')
          .upsert({ round_id: round.id, hole: holeNo, gross: value }, { onConflict: 'round_id,hole' })
          .select()
          .single();
        if (error) throw error;
        round.scoreMap.set(holeNo, data);
        ptsEl.textContent = `${data.points} punt${data.points === 1 ? '' : 'en'}`;
      }
      const { data: fresh } = await supabase.from('rounds').select('*').eq('id', round.id).single();
      Object.assign(round, fresh);
      if (adminMode) renderAdminSummaryOnly(); else updateRoundSummary(round);
    };

    input.addEventListener('change', () => save().catch(err => alert(err.message)));
    card.querySelector('.minus')?.addEventListener('click', () => {
      const current = Number(input.value) || Math.max(1, Number(hole.par) + strokes);
      input.value = Math.max(1, current - 1);
      input.dispatchEvent(new Event('change'));
    });
    card.querySelector('.plus')?.addEventListener('click', () => {
      const current = Number(input.value) || Math.max(1, Number(hole.par) + strokes);
      input.value = Math.min(20, current + 1);
      input.dispatchEvent(new Event('change'));
    });
  });
}

async function submitActiveRound() {
  const r = state.activeRound;
  if (!r) return;
  if (Number(r.holes_filled) !== 18) {
    setMessage($('roundMessage'), `Nog ${18 - Number(r.holes_filled)} holes niet ingevuld.`, 'error');
    return;
  }
  const { error } = await supabase.rpc('submit_round', { p_round_id: r.id });
  if (error) {
    setMessage($('roundMessage'), error.message, 'error');
    return;
  }
  await loadRound(r.id, false);
  setMessage($('roundMessage'), 'Kaart ingeleverd. De score telt nu mee in het klassement.', 'ok');
}


const PHOTO_MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

function photoCategoryLabel(category) {
  return {
    day1: 'Dag 1 · Jakobsberg',
    day2: 'Dag 2 · Bitburg',
    day3: 'Dag 3 · Lüderich',
    classics: 'Klassiekers'
  }[category] || category;
}

async function decodePhoto(file) {
  const lower = file.name.toLowerCase();
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    lower.endsWith('.heic') ||
    lower.endsWith('.heif');

  let sourceFile = file;

  if (isHeic) {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm');
      const converted = await mod.default({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      sourceFile = Array.isArray(converted) ? converted[0] : converted;
    } catch (err) {
      throw new Error('Deze HEIC-foto kon niet worden omgezet. Probeer de foto als JPEG op te slaan.');
    }
  }

  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(sourceFile, { imageOrientation: 'from-image' });
    } catch (_) {}
  }

  const url = URL.createObjectURL(sourceFile);
  try {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('De foto kon niet worden gelezen.'));
    });
    img.src = url;
    return await loaded;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function compressPhoto(file) {
  if (!file) throw new Error('Kies eerst een foto.');
  if (file.size > PHOTO_MAX_ORIGINAL_BYTES) throw new Error('Deze foto is groter dan 10 MB.');
  if (file.type && !file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error('Alleen foto\'s zijn toegestaan.');
  }

  const image = await decodePhoto(file);
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  if (!width || !height) throw new Error('De foto-afmetingen konden niet worden gelezen.');

  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(image, 0, 0, outW, outH);
  if (image.close) image.close();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
  if (!blob) throw new Error('De foto kon niet worden gecomprimeerd.');
  return blob;
}

function setPhotoCategory(category) {
  state.photoCategory = category;
  document.querySelectorAll('.photo-category').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.photoCategory === category);
  });
  $('photoUploadHeading').textContent = photoCategoryLabel(category);
  loadPhotos();
}

async function loadPhotos() {
  const { data, error } = await supabase
    .from('photos')
    .select('id,category,caption,storage_path,created_at,player_id,players(name)')
    .eq('category', state.photoCategory)
    .order('created_at', { ascending: false });

  if (error) {
    $('photoGallery').innerHTML = '';
    $('photoEmptyState').classList.remove('hidden');
    $('photoEmptyState').textContent = error.message;
    return;
  }

  const photos = data || [];
  state.photos = photos;
  $('photoEmptyState').classList.toggle('hidden', photos.length > 0);
  $('photoEmptyState').textContent = 'Nog geen foto\'s in deze categorie.';

  const rendered = [];
  for (const photo of photos) {
    const { data: signed, error: signedError } = await supabase.storage
      .from('golf-fotos')
      .createSignedUrl(photo.storage_path, 60 * 60);
    if (!signedError && signed?.signedUrl) rendered.push({ ...photo, url: signed.signedUrl });
  }

  $('photoGallery').innerHTML = rendered.map(photo => `
    <article class="photo-item">
      <button class="photo-open" type="button"
        data-url="${esc(photo.url)}"
        data-title="${esc(photo.players?.name || 'Onbekend')}"
        data-caption="${esc(photo.caption || '')}">
        <img src="${esc(photo.url)}" loading="lazy"
          alt="${esc(photo.caption || `Foto van ${photo.players?.name || 'deelnemer'}`)}">
      </button>
      <div class="photo-meta">
        <strong>${esc(photo.players?.name || 'Onbekend')}</strong>
        ${photo.caption ? `<span>${esc(photo.caption)}</span>` : ''}
      </div>
    </article>`).join('');

  $('photoGallery').querySelectorAll('.photo-open').forEach(btn => {
    btn.addEventListener('click', () => openPhotoLightbox(
      btn.dataset.url,
      btn.dataset.title,
      btn.dataset.caption
    ));
  });

  if (state.admin) loadAdminPhotoList();
}

async function uploadPhoto() {
  const file = $('photoFileInput').files?.[0];
  const playerId = $('photoPlayerSelect').value;
  const caption = $('photoCaptionInput').value.trim();

  if (!playerId) return setMessage($('photoUploadMessage'), 'Kies je naam.', 'error');
  if (!file) return setMessage($('photoUploadMessage'), 'Kies eerst een foto.', 'error');

  $('photoUploadBtn').disabled = true;
  $('photoUploadProgress').classList.remove('hidden');
  $('photoUploadProgressBar').style.width = '12%';
  setMessage($('photoUploadMessage'), 'Foto voorbereiden...');

  let storagePath = null;

  try {
    const compressed = await compressPhoto(file);
    $('photoUploadProgressBar').style.width = '45%';

    storagePath = `${state.photoCategory}/${playerId}/${Date.now()}-${crypto.randomUUID()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('golf-fotos')
      .upload(storagePath, compressed, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    $('photoUploadProgressBar').style.width = '78%';

    const { error: rowError } = await supabase.from('photos').insert({
      category: state.photoCategory,
      player_id: playerId,
      caption: caption || null,
      storage_path: storagePath,
      uploaded_by_user_id: state.user?.id || null
    });

    if (rowError) throw rowError;

    $('photoUploadProgressBar').style.width = '100%';
    $('photoFileInput').value = '';
    $('photoCaptionInput').value = '';
    setMessage($('photoUploadMessage'), 'Foto toegevoegd.', 'ok');
    await loadPhotos();
  } catch (err) {
    if (storagePath) {
      try { await supabase.storage.from('golf-fotos').remove([storagePath]); } catch (_) {}
    }
    setMessage($('photoUploadMessage'), err.message, 'error');
  } finally {
    setTimeout(() => {
      $('photoUploadProgress').classList.add('hidden');
      $('photoUploadProgressBar').style.width = '0';
    }, 500);
    $('photoUploadBtn').disabled = false;
  }
}

function openPhotoLightbox(url, title, caption) {
  $('photoLightboxImage').src = url;
  $('photoLightboxImage').alt = caption || `Foto van ${title}`;
  $('photoLightboxTitle').textContent = title || '';
  $('photoLightboxCaption').textContent = caption || '';
  $('photoLightbox').classList.remove('hidden');
}

function closePhotoLightbox() {
  $('photoLightbox').classList.add('hidden');
  $('photoLightboxImage').src = '';
}

async function loadAdminPhotoList() {
  if (!state.admin) return;

  const { data, error } = await supabase
    .from('photos')
    .select('id,category,caption,storage_path,created_at,players(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    $('adminPhotoList').innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    return;
  }

  const rows = [];
  for (const photo of data || []) {
    const { data: signed } = await supabase.storage
      .from('golf-fotos')
      .createSignedUrl(photo.storage_path, 60 * 30);
    rows.push({ ...photo, url: signed?.signedUrl || '' });
  }

  $('adminPhotoList').innerHTML = rows.length ? rows.map(photo => `
    <div class="admin-photo-row">
      ${photo.url ? `<img src="${esc(photo.url)}" alt="">` : '<div></div>'}
      <div>
        <strong>${esc(photo.players?.name || 'Onbekend')}</strong>
        <span>${esc(photoCategoryLabel(photo.category))}${photo.caption ? ` · ${esc(photo.caption)}` : ''}</span>
      </div>
      <button class="secondary small admin-photo-delete" type="button"
        data-id="${esc(photo.id)}" data-path="${esc(photo.storage_path)}">Verwijderen</button>
    </div>`).join('') : '<p class="muted small-text">Nog geen foto\'s geüpload.</p>';

  $('adminPhotoList').querySelectorAll('.admin-photo-delete').forEach(btn => {
    btn.addEventListener('click', () => deletePhotoAsAdmin(btn.dataset.id, btn.dataset.path));
  });
}

async function deletePhotoAsAdmin(id, storagePath) {
  if (!confirm('Deze foto verwijderen?')) return;
  setMessage($('adminPhotoMessage'), 'Foto verwijderen...');

  const { error: rowError } = await supabase.from('photos').delete().eq('id', id);
  if (rowError) return setMessage($('adminPhotoMessage'), rowError.message, 'error');

  const { error: storageError } = await supabase.storage.from('golf-fotos').remove([storagePath]);
  if (storageError) {
    setMessage($('adminPhotoMessage'), `Foto uit overzicht verwijderd. Storage-melding: ${storageError.message}`, 'error');
  } else {
    setMessage($('adminPhotoMessage'), 'Foto verwijderd.', 'ok');
  }

  await loadAdminPhotoList();
  await loadPhotos();
}


async function loadPublication() {
  const { data, error } = await supabase
    .from('leaderboard_publication')
    .select('scope,published');

  if (error) throw error;

  state.publication = { day1:false, day2:false, day3:false, overall:false };
  for (const row of data || []) state.publication[row.scope] = !!row.published;
}

async function loadLeaderboard() {
  try {
    await loadPublication();
  } catch (err) {
    $('leaderboardNotice').textContent = `Publicatiestatus kon niet worden geladen: ${err.message}`;
    return;
  }

  const { data, error } = await supabase
    .from('rounds')
    .select('id,player_id,course_id,stableford_total,gross_total,status,approved,players(name),courses(day,name,short_name)')
    .in('status', ['submitted','approved']);

  if (error) {
    $('leaderboardNotice').textContent = error.message;
    return;
  }

  const anyPublished = state.admin || Object.values(state.publication).some(Boolean);
  $('leaderboardNotice').textContent = anyPublished
    ? ''
    : 'Er is nog geen klassement gepubliceerd.';

  const dayContainer = $('dayLeaderboardSections');
  dayContainer.innerHTML = '';

  for (const day of [1,2,3]) {
    const scope = `day${day}`;
    const visible = state.admin || state.publication[scope];
    if (!visible) continue;

    const course = state.courses.find(c => Number(c.day) === day);
    const candidates = (data || [])
      .filter(r => Number(r.courses.day) === day)
      .sort((a,b) => Number(b.stableford_total || 0) - Number(a.stableford_total || 0)
        || Number(a.gross_total || 999) - Number(b.gross_total || 999)
        || a.players.name.localeCompare(b.players.name));

    const max = candidates.length ? Math.max(...candidates.map(r => Number(r.stableford_total || 0))) : null;
    const winners = max === null ? '' : candidates.filter(r => Number(r.stableford_total || 0) === max).map(r => r.players.name).join(', ');

    const section = document.createElement('section');
    section.className = 'leaderboard-section';
    section.innerHTML = `
      <div class="day-result-head">
        <div>
          <div class="eyebrow">Dag ${day}</div>
          <h3>${esc(course?.name || '')}</h3>
        </div>
        ${max === null
          ? '<span class="day-winner-pill">Nog geen uitslag</span>'
          : `<span class="day-winner-pill">Dagwinnaar: ${esc(winners)} · ${max} pt</span>`}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Speler</th><th>Stableford</th><th>Bruto</th><th>Controle</th></tr></thead>
          <tbody>
            ${candidates.length ? candidates.map((r,i) => `
              <tr>
                <td>${i+1}</td>
                <td>${esc(r.players.name)}</td>
                <td><strong>${Number(r.stableford_total || 0)}</strong></td>
                <td>${Number(r.gross_total || 0)}</td>
                <td>${r.approved ? '✓' : '−'}</td>
              </tr>`).join('') : '<tr><td colspan="5">Nog geen ingeleverde kaarten.</td></tr>'}
          </tbody>
        </table>
      </div>`;
    dayContainer.appendChild(section);
  }

  const overallVisible = state.admin || state.publication.overall;
  $('overallLeaderboardSection').classList.toggle('hidden', !overallVisible);

  if (overallVisible) {
    const map = new Map();
    for (const p of state.players) map.set(p.id, { name:p.name, days:[null,null,null], approved:[false,false,false] });
    for (const r of data || []) {
      const item = map.get(r.player_id);
      if (!item) continue;
      const idx = Number(r.courses.day) - 1;
      item.days[idx] = Number(r.stableford_total || 0);
      item.approved[idx] = !!r.approved;
    }

    const rows = [...map.values()].map(x => ({
      ...x,
      total: x.days.reduce((sum,v) => sum + (v ?? 0), 0),
      played: x.days.filter(v => v !== null).length
    })).sort((a,b) => b.total - a.total || b.played - a.played || a.name.localeCompare(b.name));

    $('leaderboardBody').innerHTML = rows.map((r,i) => `
      <tr>
        <td>${i+1}</td>
        <td>${esc(r.name)}</td>
        ${r.days.map((v,idx) => `<td>${v === null ? '−' : `${v}${r.approved[idx] ? ' ✓' : ''}`}</td>`).join('')}
        <td><strong>${r.total}</strong></td>
      </tr>`).join('');
  }

  if (state.admin) renderPublicationControls();
}

function renderPublicationControls() {
  const labels = {
    day1: 'Dag 1 · Jakobsberg',
    day2: 'Dag 2 · Bitburg',
    day3: 'Dag 3 · Lüderich',
    overall: 'Weekendklassement'
  };

  $('publicationControls').innerHTML = Object.entries(labels).map(([scope,label]) => {
    const published = !!state.publication[scope];
    return `
      <div class="publish-control">
        <strong>${esc(label)}</strong>
        <span>${published ? 'Zichtbaar voor alle spelers' : 'Alleen zichtbaar voor wedstrijdleiding'}</span>
        <button type="button" class="${published ? 'secondary' : 'primary'} small publication-toggle"
          data-scope="${scope}" data-value="${published ? 'false' : 'true'}">
          ${published ? 'Verbergen' : 'Publiceren'}
        </button>
      </div>`;
  }).join('');

  $('publicationControls').querySelectorAll('.publication-toggle').forEach(btn => {
    btn.addEventListener('click', () => setPublication(btn.dataset.scope, btn.dataset.value === 'true'));
  });
}

async function setPublication(scope, published) {
  setMessage($('publicationMessage'), published ? 'Publiceren...' : 'Verbergen...');
  const { error } = await supabase.rpc('admin_set_publication', {
    p_scope: scope,
    p_published: published
  });
  if (error) {
    setMessage($('publicationMessage'), error.message, 'error');
    return;
  }
  await loadLeaderboard();
  setMessage(
    $('publicationMessage'),
    published ? 'Klassement is gepubliceerd.' : 'Klassement is weer verborgen.',
    'ok'
  );
}

async function adminLogin() {
  const pin = $('adminPinInput').value.trim();
  if (!pin) return setMessage($('adminLoginMessage'), 'Vul de PIN in.', 'error');
  const { data, error } = await supabase.rpc('admin_login', { p_pin: pin });
  if (error || !data) {
    setMessage($('adminLoginMessage'), error?.message || 'Onjuiste PIN.', 'error');
    return;
  }
  state.admin = true;
  $('adminLoginPanel').classList.add('hidden');
  $('adminPanel').classList.remove('hidden');
  setMessage($('adminLoginMessage'), '');
  await loadAdminCards();
  await loadLeaderboard();
  await loadAdminPhotoList();
}

async function adminLogout() {
  await supabase.rpc('admin_logout');
  state.admin = false;
  state.adminEditor = null;
  $('adminPanel').classList.add('hidden');
  $('adminEditorPanel').classList.add('hidden');
  $('adminLoginPanel').classList.remove('hidden');
  $('adminPinInput').value = '';
  $('publicationControls').innerHTML = '';
}

async function loadAdminCards() {
  const { data: rounds, error } = await supabase
    .from('rounds')
    .select('id,player_id,course_id,handicap_index,course_handicap,stableford_total,gross_total,holes_filled,status,approved,players(name),courses(day,name,short_name)')
    .order('created_at');
  if (error) {
    $('adminCards').innerHTML = `<p>${esc(error.message)}</p>`;
    return;
  }
  const byKey = new Map(rounds.map(r => [`${r.player_id}:${r.course_id}`, r]));
  const filter = $('adminCourseFilter').value;
  const cards = [];
  for (const course of state.courses) {
    if (filter !== 'all' && filter !== course.id) continue;
    for (const player of state.players) {
      const r = byKey.get(`${player.id}:${course.id}`);
      const status = r?.approved ? 'approved' : (r?.status || 'not_started');
      const label = {not_started:'Niet gestart',in_progress:'Bezig',submitted:'Ingeleverd',approved:'Goedgekeurd'}[status];
      cards.push(`
        <article class="admin-card">
          <div class="admin-card-top">
            <div>
              <h3>${esc(player.name)}</h3>
              <p>Dag ${course.day} · ${esc(course.short_name || course.name)}</p>
            </div>
            <span class="status ${status}">${label}</span>
          </div>
          <p>${r ? `HCP ${Number(r.handicap_index).toFixed(1).replace('.', ',')} · BH ${r.course_handicap} · ${r.holes_filled}/18 holes · ${r.stableford_total} pt` : 'Nog geen kaart'}</p>
          <button type="button" class="secondary small admin-open" data-player="${player.id}" data-course="${course.id}" data-round="${r?.id || ''}">${r ? 'Kaart openen' : 'Kaart invoeren'}</button>
        </article>`);
    }
  }
  $('adminCards').innerHTML = cards.join('');
  $('adminCards').querySelectorAll('.admin-open').forEach(btn => btn.addEventListener('click', () => openAdminEditor(btn.dataset.player, btn.dataset.course, btn.dataset.round || null)));
}

async function openAdminEditor(playerId, courseId, roundId) {
  const player = state.players.find(p => p.id === playerId);
  const course = state.courses.find(c => c.id === courseId);
  state.adminEditor = { player_id: playerId, course_id: courseId, players: player, courses: course, id: roundId };
  $('adminEditorPanel').classList.remove('hidden');
  $('adminEditorTitle').textContent = `${player.name} · Dag ${course.day}`;
  $('adminEditorMeta').textContent = course.name;
  $('adminHandicapInput').value = '';
  $('adminHolesGrid').innerHTML = '';
  setMessage($('adminEditorMessage'), '');
  if (roundId) await loadRound(roundId, true);
  $('adminEditorPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

function renderAdminEditor() {
  const r = state.adminEditor;
  $('adminEditorTitle').textContent = `${r.players.name} · Dag ${r.courses.day}`;
  $('adminEditorMeta').textContent = `${r.courses.name} · Baanhandicap ${r.course_handicap} · ${r.stableford_total ?? 0} pt · ${r.holes_filled ?? 0}/18`;
  $('adminHandicapInput').value = Number(r.handicap_index).toFixed(1);

  const holes = state.holes.get(r.course_id) || [];
  $('adminHolesGrid').innerHTML = holes.map(h => {
    const saved = r.scoreMap.get(Number(h.hole));
    const strokes = strokesOnHole(Number(r.course_handicap), Number(h.stroke_index));
    return `
      <article class="hole-card" data-hole="${h.hole}">
        <div class="hole-top"><strong>Hole ${h.hole}</strong><span>Par ${h.par} · SI ${h.stroke_index}</span></div>
        <div class="hole-sub">Slagen mee: ${strokes >= 0 ? '+'+strokes : strokes}</div>
        <div class="score-control">
          <button type="button" class="minus">−</button>
          <input class="gross" type="number" inputmode="numeric" min="1" max="20" value="${saved?.gross ?? ''}" placeholder="-">
          <button type="button" class="plus">+</button>
        </div>
        <div class="hole-points">${saved?.gross ? `${saved.points} punten` : '0 punten'}</div>
      </article>`;
  }).join('');
  attachScoreControls($('adminHolesGrid'), r, true);
}

function renderAdminSummaryOnly() {
  const r = state.adminEditor;
  $('adminEditorMeta').textContent = `${r.courses.name} · Baanhandicap ${r.course_handicap} · ${r.stableford_total ?? 0} pt · ${r.holes_filled ?? 0}/18`;
}

async function adminStartOrUpdate() {
  const r = state.adminEditor;
  const handicap = Number($('adminHandicapInput').value.replace(',', '.'));
  if (!Number.isFinite(handicap) || handicap < -10 || handicap > 54) {
    return setMessage($('adminEditorMessage'), 'Vul een geldige Handicap Index in.', 'error');
  }
  const { data, error } = await supabase.rpc('admin_upsert_round', {
    p_player_id: r.player_id,
    p_course_id: r.course_id,
    p_handicap_index: handicap
  });
  if (error) return setMessage($('adminEditorMessage'), error.message, 'error');
  await loadRound(data, true);
  setMessage($('adminEditorMessage'), 'Kaart is klaar voor invoer.', 'ok');
  await loadAdminCards();
}

async function adminSetStatus(action) {
  const r = state.adminEditor;
  if (!r?.id) return setMessage($('adminEditorMessage'), 'Maak de kaart eerst aan.', 'error');
  const fn = {submit:'admin_submit_round',approve:'admin_approve_round',reopen:'admin_reopen_round'}[action];
  const { error } = await supabase.rpc(fn, { p_round_id: r.id });
  if (error) return setMessage($('adminEditorMessage'), error.message, 'error');
  await loadRound(r.id, true);
  setMessage($('adminEditorMessage'), action === 'approve' ? 'Kaart goedgekeurd.' : action === 'reopen' ? 'Kaart heropend.' : 'Kaart gemarkeerd als ingeleverd.', 'ok');
  await loadAdminCards();
  await loadLeaderboard();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('.photo-category').forEach(btn => btn.addEventListener('click', () => setPhotoCategory(btn.dataset.photoCategory)));
  $('photoUploadBtn').addEventListener('click', uploadPhoto);
  $('refreshPhotosBtn').addEventListener('click', loadPhotos);
  $('photoLightboxClose').addEventListener('click', closePhotoLightbox);
  $('photoLightbox').addEventListener('click', (e) => { if (e.target === $('photoLightbox')) closePhotoLightbox(); });
  $('adminRefreshPhotosBtn').addEventListener('click', loadAdminPhotoList);
  $('courseSelect').addEventListener('change', updateCourseInfo);
  $('startRoundBtn').addEventListener('click', () => openPlayerRound().catch(err => setMessage($('setupMessage'), err.message, 'error')));
  $('submitRoundBtn').addEventListener('click', () => submitActiveRound().catch(err => setMessage($('roundMessage'), err.message, 'error')));
  $('closeRoundBtn').addEventListener('click', () => $('scoreCardPanel').classList.add('hidden'));
  $('refreshLeaderboardBtn').addEventListener('click', loadLeaderboard);
  $('adminLoginBtn').addEventListener('click', adminLogin);
  $('adminLogoutBtn').addEventListener('click', adminLogout);
  $('adminRefreshBtn').addEventListener('click', loadAdminCards);
  $('adminCourseFilter').addEventListener('change', loadAdminCards);
  $('adminEditorCloseBtn').addEventListener('click', () => $('adminEditorPanel').classList.add('hidden'));
  $('adminStartOrUpdateBtn').addEventListener('click', adminStartOrUpdate);
  $('adminSubmitBtn').addEventListener('click', () => adminSetStatus('submit'));
  $('adminApproveBtn').addEventListener('click', () => adminSetStatus('approve'));
  $('adminReopenBtn').addEventListener('click', () => adminSetStatus('reopen'));
}

async function init() {
  bindEvents();
  try {
    await ensureAnonymousSession();
    await loadReferenceData();
    $('connectionBadge').textContent = 'Online';
    await loadLeaderboard();

    const { data } = await supabase.rpc('is_admin');
    if (data) {
      state.admin = true;
      $('adminLoginPanel').classList.add('hidden');
      $('adminPanel').classList.remove('hidden');
      await loadAdminPhotoList();
    }

    supabase.channel('leaderboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, () => loadLeaderboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard_publication' }, () => loadLeaderboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, () => { if (document.querySelector('#tab-photos.active')) loadPhotos(); })
      .subscribe();
  } catch (err) {
    console.error(err);
    $('connectionBadge').textContent = 'Setup nodig';
    setMessage($('setupMessage'), err.message, 'error');
  }
}

init();
