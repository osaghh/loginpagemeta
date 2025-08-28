const form = document.getElementById('resolve-form');
const urlInput = document.getElementById('url');
const resolveBtn = document.getElementById('resolve-btn');

const resultEl = document.getElementById('result');
const titleEl = document.getElementById('post-title');
const metaEl  = document.getElementById('post-meta');
const gallery = document.getElementById('gallery');
const downloadAllBtn = document.getElementById('download-all');

let lastResult = null;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  setBusy(true);
  clearResults();

  try {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to resolve');

    lastResult = data;
    populate(data);
  } catch (err) {
    alert(err.message || 'Something went wrong.');
  } finally {
    setBusy(false);
  }
});

downloadAllBtn.addEventListener('click', async () => {
  if (!lastResult?.media?.length) return;
  downloadAllBtn.disabled = true;

  try {
    const zip = new JSZip();
    let i = 1;
    for (const m of lastResult.media) {
      const name = buildName(lastResult, m, i);
      const proxied = `/api/download?src=${encodeURIComponent(m.url)}&type=${m.type}&name=${encodeURIComponent(name)}`;

      const blob = await fetch(proxied).then(r => r.blob());
      const ext = guessExtFromType(blob.type) || (m.type === 'video' ? 'mp4' : 'jpg');
      zip.file(`${name}.${ext}`, blob);
      i++;
    }
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, buildArchiveName(lastResult));
  } catch (e) {
    alert('Failed to zip files. Please download individually.');
  } finally {
    downloadAllBtn.disabled = false;
  }
});

function populate(data) {
  resultEl.classList.remove('hidden');
  titleEl.textContent = data.title || 'Instagram';
  metaEl.textContent = [
    data.author ? `@${data.author}` : null,
    data.shortcode ? `#${data.shortcode}` : null,
    data.count ? `${data.count} file${data.count > 1 ? 's' : ''}` : null
  ].filter(Boolean).join(' • ');

  gallery.innerHTML = '';
  let i = 1;
  for (const m of data.media) {
    const tile = document.createElement('div');
    tile.className = 'tile';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    if (m.type === 'video') {
      const v = document.createElement('video');
      v.src = m.url;
      v.controls = true;
      v.playsInline = true;
      thumb.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = m.url;
      thumb.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = m.type.toUpperCase();
    meta.appendChild(badge);

    const btn = document.createElement('button');
    btn.textContent = 'Download';
    btn.addEventListener('click', () => {
      const name = buildName(data, m, i);
      const href = `/api/download?src=${encodeURIComponent(m.url)}&type=${m.type}&name=${encodeURIComponent(name)}`;
      // trigger save
      const a = document.createElement('a');
      a.href = href;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    meta.appendChild(btn);

    tile.appendChild(thumb);
    tile.appendChild(meta);
    gallery.appendChild(tile);

    i++;
  }
}

function clearResults() {
  resultEl.classList.add('hidden');
  gallery.innerHTML = '';
  titleEl.textContent = '';
  metaEl.textContent = '';
  lastResult = null;
}

function setBusy(b) {
  resolveBtn.disabled = b;
  resolveBtn.textContent = b ? 'Fetching…' : 'Fetch';
}

function buildName(data, m, index) {
  const base = [
    data.author ? data.author : 'instagram',
    data.shortcode ? data.shortcode : '',
    index?.toString().padStart(2, '0')
  ].filter(Boolean).join('_');
  return `${base}_${m.type}`;
}

function buildArchiveName(data) {
  return [
    'IG',
    data.author ? data.author : 'post',
    data.shortcode ? data.shortcode : ''
  ].filter(Boolean).join('_') + '.zip';
}

function guessExtFromType(ct) {
  if (!ct) return null;
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  return null;
}
