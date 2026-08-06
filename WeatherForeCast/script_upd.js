const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const unitBtn = document.getElementById('unitBtn');
let chartInstance = null;
let unit = 'C'; // 'C' or 'F'
let lastWeatherData = null;
let lastLocationLabel = '';

// Surface ANY error directly on the page instead of failing silently,
// so problems are visible even without opening the browser console.
window.addEventListener('error', (e) => {
  statusEl.textContent = 'Error: ' + e.message;
  console.error(e);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
  statusEl.textContent = 'Error: ' + msg;
  console.error(e.reason);
});

// WMO weather code -> { icon, desc, animClass, mood }
const weatherMap = {
  0:  { icon:'☀️', desc:'Clear Sky', anim:'anim-spin', mood:'sun' },
  1:  { icon:'🌤️', desc:'Mainly Clear', anim:'anim-float', mood:'sun' },
  2:  { icon:'⛅', desc:'Partly Cloudy', anim:'anim-float', mood:'' },
  3:  { icon:'☁️', desc:'Overcast', anim:'anim-float', mood:'' },
  45: { icon:'🌫️', desc:'Fog', anim:'anim-float', mood:'' },
  48: { icon:'🌫️', desc:'Depositing Rime Fog', anim:'anim-float', mood:'' },
  51: { icon:'🌦️', desc:'Light Drizzle', anim:'anim-rain', mood:'rain' },
  53: { icon:'🌦️', desc:'Drizzle', anim:'anim-rain', mood:'rain' },
  55: { icon:'🌧️', desc:'Dense Drizzle', anim:'anim-rain', mood:'rain' },
  61: { icon:'🌧️', desc:'Slight Rain', anim:'anim-rain', mood:'rain' },
  63: { icon:'🌧️', desc:'Rain', anim:'anim-rain', mood:'rain' },
  65: { icon:'🌧️', desc:'Heavy Rain', anim:'anim-rain', mood:'rain' },
  71: { icon:'🌨️', desc:'Slight Snow', anim:'anim-float', mood:'night' },
  73: { icon:'🌨️', desc:'Snow', anim:'anim-float', mood:'night' },
  75: { icon:'❄️', desc:'Heavy Snow', anim:'anim-float', mood:'night' },
  80: { icon:'🌧️', desc:'Rain Showers', anim:'anim-rain', mood:'rain' },
  81: { icon:'🌧️', desc:'Heavy Showers', anim:'anim-rain', mood:'rain' },
  82: { icon:'⛈️', desc:'Violent Showers', anim:'anim-rain', mood:'rain' },
  95: { icon:'⛈️', desc:'Thunderstorm', anim:'anim-rain', mood:'rain' },
  96: { icon:'⛈️', desc:'Thunderstorm + Hail', anim:'anim-rain', mood:'rain' },
  99: { icon:'⛈️', desc:'Severe Thunderstorm', anim:'anim-rain', mood:'rain' },
};
function getWeather(code) { return weatherMap[code] || { icon:'🌡️', desc:'Unknown', anim:'', mood:'' }; }

function cToF(c) { return (c * 9/5) + 32; }
function displayTemp(c) {
  const val = unit === 'C' ? c : cToF(c);
  return Math.round(val) + '°' + unit;
}

function toggleUnit() {
  unit = unit === 'C' ? 'F' : 'C';
  unitBtn.textContent = unit === 'C' ? 'Switch to °F' : 'Switch to °C';
  if (lastWeatherData) {
    renderCurrent(lastWeatherData, lastLocationLabel);
    renderForecast(lastWeatherData);
    renderHourlyChart(lastWeatherData);
  }
}

// --- Search by typed city/village name ---
// Tries Open-Meteo first (fast, good for major cities), falls back to
// Nominatim/OpenStreetMap (slower, but indexes small villages/hamlets worldwide).
async function searchCity() {
  const query = document.getElementById('cityInput').value.trim();
  if (!query) { statusEl.textContent = 'Please enter a city or village name.'; return; }
  statusEl.textContent = 'Searching...';
  contentEl.style.display = 'none';

  try {
    // Attempt 1: Open-Meteo geocoder (major places only)
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`);
    const geoData = await geoRes.json();

    if (geoData.results && geoData.results.length > 0) {
      const place = geoData.results[0];
      const label = `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}, ${place.country}`;
      await loadWeatherByCoords(place.latitude, place.longitude, label);
      return;
    }

    // Attempt 2: Photon (OSM-based geocoder, covers villages/hamlets, works
    // reliably from plain browser fetch — no referrer requirements like Nominatim)
    statusEl.textContent = 'Checking detailed map data for smaller places...';
    let photonData;
    try {
      const photonRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`);
      if (!photonRes.ok) throw new Error(`Photon API returned status ${photonRes.status}`);
      photonData = await photonRes.json();
    } catch (photonErr) {
      console.error('Photon geocoder failed:', photonErr);
      statusEl.textContent = `Could not reach the map service (${photonErr.message}). Check your internet connection and try again.`;
      return;
    }

    if (!photonData.features || photonData.features.length === 0) {
      statusEl.textContent = `No place found for "${query}". Try adding the district name (e.g. "Thagarapuvalasa, Visakhapatnam") or use "Use My Location".`;
      return;
    }

    const feature = photonData.features[0];
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties || {};
    const placeName = props.name || query;
    const state = props.state || '';
    const country = props.country || '';
    const label = [placeName, state, country].filter(Boolean).join(', ');

    await loadWeatherByCoords(lat, lon, label);
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Something went wrong: ${err.message}. Open the browser console (F12) for details.`;
  }
}

// --- Use device GPS + reverse geocode (works for villages worldwide) ---
function useMyLocation() {
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation is not supported on this device/browser.';
    return;
  }
  statusEl.textContent = 'Getting your location... (allow the permission prompt if asked)';
  contentEl.style.display = 'none';

  // Safety net: if neither callback fires within 15s (can happen on file:// or
  // other non-secure contexts), tell the user instead of hanging forever.
  const safetyTimer = setTimeout(() => {
    statusEl.textContent = 'Location request timed out. This often happens when the page is opened directly as a file — try running it through a local server (e.g. VS Code Live Server) instead.';
  }, 15000);

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      clearTimeout(safetyTimer);
      const { latitude, longitude } = pos.coords;
      try {
        statusEl.textContent = 'Finding your area name...';
        // Free reverse geocoding, no API key, resolves villages/localities well
        const revRes = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
        );
        const revData = await revRes.json();
        const label = [
          revData.locality || revData.city || revData.principalSubdivision,
          revData.principalSubdivision,
          revData.countryName
        ].filter(Boolean).join(', ');

        await loadWeatherByCoords(latitude, longitude, label || 'Your Location');
      } catch (err) {
        console.error(err);
        // Even if reverse geocoding fails, we can still show weather by coords
        await loadWeatherByCoords(latitude, longitude, 'Your Location');
      }
    },
    (err) => {
      clearTimeout(safetyTimer);
      console.error(err);
      statusEl.textContent = `Location error: ${err.message}. Please allow location permission and ensure the page is served over https or localhost.`;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// --- Shared fetch + render pipeline ---
async function loadWeatherByCoords(latitude, longitude, label) {
  statusEl.textContent = 'Fetching weather...';
  try {
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=auto&forecast_days=6`
    );
    if (!wRes.ok) throw new Error(`Weather API returned status ${wRes.status}`);
    const wData = await wRes.json();
    if (!wData.current) throw new Error('Weather API response was missing current conditions data');

    lastWeatherData = wData;
    lastLocationLabel = label;

    renderCurrent(wData, label);
    renderForecast(wData);
    renderHourlyChart(wData);

    statusEl.textContent = '';
    contentEl.style.display = 'block';
  } catch (err) {
    console.error('Failed to load weather:', err);
    statusEl.textContent = `Could not load weather data: ${err.message}`;
  }
}

function renderCurrent(data, locationLabel) {
  const cur = data.current;
  const w = getWeather(cur.weather_code);
  const isDay = cur.is_day === 1;
  document.body.className = !isDay ? 'night' : w.mood;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });

  document.getElementById('currentCard').innerHTML = `
    <h2>${locationLabel}</h2>
    <div class="date">${dateStr}</div>
    <div class="icon-big ${w.anim}">${w.icon}</div>
    <div class="temp-big">${displayTemp(cur.temperature_2m)}</div>
    <div class="desc">${w.desc}</div>
    <div class="meta-row">
      <div class="meta-item">Feels Like <span>${displayTemp(cur.apparent_temperature)}</span></div>
      <div class="meta-item">Humidity <span>${cur.relative_humidity_2m}%</span></div>
      <div class="meta-item">Wind <span>${Math.round(cur.wind_speed_10m)} km/h</span></div>
    </div>
  `;
}

function renderForecast(data) {
  const days = data.daily.time;
  const codes = data.daily.weather_code;
  const max = data.daily.temperature_2m_max;
  const min = data.daily.temperature_2m_min;
  const row = document.getElementById('forecastRow');
  row.innerHTML = '';

  for (let i = 0; i < Math.min(5, days.length); i++) {
    const date = new Date(days[i]);
    const dname = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday:'short' });
    const w = getWeather(codes[i]);
    row.innerHTML += `
      <div class="day-card">
        <div class="dname">${dname}</div>
        <div class="icon">${w.icon}</div>
        <div class="range">${displayTemp(max[i])} / ${displayTemp(min[i])}</div>
      </div>
    `;
  }
}

function renderHourlyChart(data) {
  const now = new Date();
  const times = data.hourly.time;
  const temps = data.hourly.temperature_2m;

  let startIdx = times.findIndex(t => new Date(t) >= now);
  if (startIdx === -1) startIdx = 0;
  const labels = times.slice(startIdx, startIdx + 24).map(t =>
    new Date(t).toLocaleTimeString('en-US', { hour:'numeric' })
  );
  const values = temps.slice(startIdx, startIdx + 24).map(v => unit === 'C' ? v : cToF(v));

  const ctx = document.getElementById('hourlyChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `Temperature (°${unit})`,
        data: values,
        borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255,107,107,0.2)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color:'#fff' } } },
      scales: {
        x: { ticks: { color:'#fff' }, grid: { color:'rgba(255,255,255,0.1)' } },
        y: { ticks: { color:'#fff' }, grid: { color:'rgba(255,255,255,0.1)' } }
      }
    }
  });
}

// Load a default city immediately so the page always shows something on open.
// Geolocation is only triggered when the user explicitly clicks "My Location" —
// running it automatically on load can hang silently (no success, no error callback)
// on pages opened via file:// or any non-secure context.
window.onload = () => {
  document.getElementById('cityInput').value = 'Visakhapatnam';
  searchCity();
};

document.getElementById('cityInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') searchCity();
});