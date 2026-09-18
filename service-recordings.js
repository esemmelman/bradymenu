(() => {
  const button = document.querySelector('#service-record-button');
  const endpoint = `${supabaseUrl}/rest/v1/bradymenu_service_recordings_v1`;
  let recorder = null;
  let busy = false;
  let timer;

  function headers(id, extra = {}) {
    return { ...supabaseHeaders, 'x-recording-id': id, ...extra };
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
  }

  async function saveWithRetry(item) {
    try {
      await save(item);
    } catch {
      await save(item);
    }
  }

  function stop() {
    if (recorder?.state === 'recording') {
      button.disabled = true;
      recorder.stop();
      clearTimeout(timer);
    }
  }
  window.stopServiceRecording = stop;

  button.onclick = async () => {
    if (recorder?.state === 'recording') { stop(); return; }
    if (busy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = 'Stop Recording';
    button.setAttribute('aria-pressed', 'true');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(value => MediaRecorder.isTypeSupported(value));
      const capture = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      const item = { id: crypto.randomUUID(), title: window.servicePassageTitle, start: new Date().toISOString() };
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      capture.onstop = async () => {
        clearTimeout(timer);
        stream.getTracks().forEach(track => track.stop());
        recorder = null;
        busy = true;
        button.textContent = 'Record';
        button.setAttribute('aria-pressed', 'false');
        item.blob = new Blob(chunks, { type: capture.mimeType || type || 'audio/webm' });
        try {
          if (item.blob.size) await saveWithRetry(item);
        } catch (error) {
          console.error(error);
        } finally {
          busy = false;
          button.disabled = false;
        }
      };
      capture.onerror = stop;
      capture.start(1000);
      recorder = capture;
      button.disabled = false;
      timer = setTimeout(stop, 120000);
      busy = false;
    } catch (error) {
      console.error(error);
      stream?.getTracks().forEach(track => track.stop());
      busy = false;
      button.disabled = false;
      button.textContent = 'Record';
      button.setAttribute('aria-pressed', 'false');
    }
  };

  window.addEventListener('beforeunload', event => {
    if (recorder || busy) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
