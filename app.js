// Morningwoodies Duitsland 2026
// Wrapper rond app-core.js
// Behoudt de fotonaam-fix en voegt birdie-markering toe op de scorekaart.

await import('./app-core.js?v=20260908-2');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function injectBirdieStyles() {
  if (document.getElementById('birdie-style-fix')) return;

  const style = document.createElement('style');
  style.id = 'birdie-style-fix';
  style.textContent = `
    .hole-card.has-birdie {
      border-color: rgba(23,59,43,.35);
      box-shadow: 0 0 0 2px rgba(23,59,43,.06);
    }

    .birdie-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding: 5px 8px;
      border-radius: 999px;
      background: var(--green-soft, #e7efe9);
      color: var(--green, #173b2b);
      font-size: 11px;
      font-weight: 800;
    }
  `;
  document.head.appendChild(style);
}

function syncPhotoPlayers() {
  const mainSelect = document.getElementById('playerSelect');
  const photoSelect = document.getElementById('photoPlayerSelect');

  if (!mainSelect || !photoSelect || mainSelect.options.length === 0) {
    return false;
  }

  const previousValue = photoSelect.value;
  photoSelect.innerHTML = '';

  for (const option of mainSelect.options) {
    photoSelect.appendChild(option.cloneNode(true));
  }

  if (previousValue && [...photoSelect.options].some(o => o.value === previousValue)) {
    photoSelect.value = previousValue;
  } else if (mainSelect.value) {
    photoSelect.value = mainSelect.value;
  } else if (photoSelect.options.length > 0) {
    photoSelect.selectedIndex = 0;
  }

  return photoSelect.options.length > 0;
}

function getParFromCard(card) {
  const meta = card.querySelector('.hole-top span');
  if (!meta) return null;
  const match = meta.textContent.match(/Par\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function updateBirdieBadge(card) {
  const input = card.querySelector('input.gross');
  if (!input) return;

  const par = getParFromCard(card);
  if (!Number.isFinite(par)) return;

  const gross = Number(input.value);
  let badge = card.querySelector('.birdie-badge');

  if (gross && gross === par - 1) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'birdie-badge';
      badge.textContent = '★ Birdie';
      const points = card.querySelector('.hole-points');
      if (points) {
        points.insertAdjacentElement('afterend', badge);
      } else {
        card.appendChild(badge);
      }
    }
    card.classList.add('has-birdie');
  } else {
    if (badge) badge.remove();
    card.classList.remove('has-birdie');
  }
}

function refreshAllBirdieBadges() {
  document.querySelectorAll('.hole-card').forEach(updateBirdieBadge);
}

function wireBirdieListeners(container = document) {
  container.querySelectorAll('.hole-card input.gross').forEach(input => {
    if (input.dataset.birdieBound === '1') return;
    input.dataset.birdieBound = '1';

    const handler = () => {
      const card = input.closest('.hole-card');
      if (card) {
        setTimeout(() => updateBirdieBadge(card), 0);
        setTimeout(() => updateBirdieBadge(card), 120);
      }
    };

    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
    input.addEventListener('blur', handler);
  });
}

async function initialisePhotoPlayerFix() {
  for (let i = 0; i < 40; i++) {
    if (syncPhotoPlayers()) break;
    await wait(125);
  }

  const photoTab = document.querySelector('[data-tab="photos"]');
  if (photoTab) {
    photoTab.addEventListener('click', () => {
      setTimeout(syncPhotoPlayers, 0);
      setTimeout(syncPhotoPlayers, 250);
    });
  }

  const mainSelect = document.getElementById('playerSelect');
  if (mainSelect) {
    mainSelect.addEventListener('change', () => {
      const photoSelect = document.getElementById('photoPlayerSelect');
      if (photoSelect && [...photoSelect.options].some(o => o.value === mainSelect.value)) {
        photoSelect.value = mainSelect.value;
      }
    });
  }

  const photoObserver = new MutationObserver(() => syncPhotoPlayers());
  if (mainSelect) {
    photoObserver.observe(mainSelect, { childList: true });
  }
}

function initialiseBirdieBadges() {
  injectBirdieStyles();
  refreshAllBirdieBadges();
  wireBirdieListeners(document);

  const observer = new MutationObserver((mutations) => {
    let shouldRefresh = false
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        shouldRefresh = true
        break
      }
    }
    if (shouldRefresh) {
      wireBirdieListeners(document);
      refreshAllBirdieBadges();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  await initialisePhotoPlayerFix();
  initialiseBirdieBadges();
});
