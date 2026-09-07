// Golfweekend Duitsland 2026
// Kleine wrapper rond de bestaande app.
// De bestaande app.js moet in GitHub eerst worden hernoemd naar app-core.js.

await import('./app-core.js?v=20260907-1');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function initialisePhotoPlayerFix() {
  // Supabase en de spelerslijst worden asynchroon geladen.
  // Geef de bestaande app maximaal enkele seconden om de 11 spelers te vullen.
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

  // Extra vangnet voor iPhone/Safari als de opties later pas beschikbaar komen.
  const observer = new MutationObserver(() => syncPhotoPlayers());
  if (mainSelect) {
    observer.observe(mainSelect, { childList: true });
  }
}

initialisePhotoPlayerFix();
