(() => {
  const button = document.querySelector('#service-record-button');
  const status = document.querySelector('#service-record-status');
  const retry = document.querySelector('#service-record-retry');
  const endpoint = `${supabaseUrl}/rest/v1/bradymenu_service_recordings_v1`;
  let recorder = null;
  let current = null;
  let busy = false;
  let timer;
  let ticker;

  function headers(id, extra = {}) {
    return { ...supabaseHeaders, 'x-recording-id': id, ...extra };
  }

  function clearCurrent() {
    current = null;
    retry.hidden = true;
  }

  function asBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function save(item) {
    const response = await fetch(`${endpoint}?on_conflict=id`, {
      method: 'POST',
      headers: headers(item.id, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({
        id: item.id,
        name: 'Brady',
        start_time: item.start,
        passage_key_text: item.title,
        mime_type: item.blob.type.split(';')[0],
        audio_base64: await asBase64(item.blob)
      })
    });
    if (!response.ok) throw new Error(`Save failed (${response.status})`);
    item.saved = true;
    retry.hidden = true;
  }

  function stop() {
    if (recorder?.state === 'recording') {
      button.disabled = true;
      recorder.stop();
      clearTimeout(timer);
      clearInterval(ticker);
    }
  }
  window.stopServiceRecording = stop;

  button.onclick = async () => {
    if (recorder?.state === 'recording') { stop(); return; }
    if (busy) return;
    if (current && !current.saved) {
      status.textContent = 'Retry saving the current recording first.';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      status.textContent = 'Recording requires a supported browser and HTTPS.';
      return;
    }
    busy = true;
    button.disabled = true;
    status.textContent = 'Waiting for microphone access…';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(value => MediaRecorder.isTypeSupported(value));
      const capture = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      const item = { id: crypto.randomUUID(), title: window.servicePassageTitle, start: new Date().toISOString(), saved: false };
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      capture.onstop = async () => {
        clearTimeout(timer);
        clearInterval(ticker);
        stream.getTracks().forEach(track => track.stop());
        recorder = null;
        button.textContent = 'Record';
        button.setAttribute('aria-pressed', 'false');
        item.blob = new Blob(chunks, { type: capture.mimeType || type || 'audio/webm' });
        try {
          if (!item.blob.size) { status.textContent = 'No audio was captured. Please record again.'; return; }
          clearCurrent();
          current = item;
          status.textContent = `Saving ${item.title}…`;
          await save(item);
          status.textContent = `${item.title} recording saved.`;
        } catch (error) {
          console.error(error);
          retry.hidden = false;
          status.textContent = 'Save failed. Keep this page open and choose Retry save.';
        } finally {
          busy = false;
          button.disabled = false;
        }
      };
      capture.onerror = stop;
      capture.start(1000);
      recorder = capture;
      button.textContent = 'Stop recording';
      button.setAttribute('aria-pressed', 'true');
      button.disabled = false;
      const started = Date.now();
      ticker = setInterval(() => {
        const seconds = Math.min(120, Math.floor((Date.now() - started) / 1000));
        status.textContent = `Recording ${item.title}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 2:00`;
      }, 500);
      timer = setTimeout(stop, 120000);
      busy = false;
    } catch (error) {
      console.error(error);
      stream?.getTracks().forEach(track => track.stop());
      busy = false;
      button.disabled = false;
      status.textContent = 'Microphone access is required. Allow access and try again.';
    }
  };

  retry.onclick = async () => {
    if (!current) return;
    retry.disabled = true;
    try {
      await save(current);
      status.textContent = `${current.title} recording saved.`;
    } catch (error) {
      console.error(error);
      status.textContent = 'Save failed. Keep this page open and retry.';
    } finally { retry.disabled = false; }
  };

  window.addEventListener('beforeunload', event => {
    if (recorder || busy || (current && !current.saved)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
