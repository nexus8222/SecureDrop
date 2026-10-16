/**
 * SecureDrop LAN — Clipboard Terminal Engine
 */

(function () {
  const el = (id) => document.getElementById(id);

  async function init() {
    await Common.initNavigation('clipboard');
    setupEditor();
  }

  function setupEditor() {
    const textEl = el('clipText');
    const countEl = el('charCount');

    textEl.addEventListener('input', () => {
      const val = textEl.value;
      const lines = val ? val.split('\n').length : 0;
      countEl.textContent = `${val.length} Characters · ${lines} Lines`;
    });

    el('clearClipBtn').onclick = () => {
      textEl.value = '';
      countEl.textContent = '0 Characters';
      el('clipOutput').classList.add('hidden');
    };

    el('publishClipBtn').onclick = async () => {
      const text = textEl.value.trim();
      if (!text) return Common.toast('Enter text to publish', 'error');

      const expiresSeconds = Number(el('clipExpiry').value || 3600);
      const password = el('clipPassword').value || null;

      try {
        const res = await Common.api('/api/clipboard', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            expires_seconds: expiresSeconds,
            password
          })
        });

        const cid = res.clipboard_id;
        const token = res.token;
        const shareUrl = `${location.origin}/share/${token}`;
        const curlCmd = `curl -s "${location.origin}/api/clipboard/${cid}" | python3 -c "import sys,json; print(json.load(sys.stdin)['text'])"`;

        el('clipIdBadge').textContent = cid;
        el('clipUrlInput').value = shareUrl;
        el('clipCurlInput').value = curlCmd;

        el('copyClipUrlBtn').onclick = () => Common.copyText(shareUrl);
        el('copyClipCurlBtn').onclick = () => Common.copyText(curlCmd);

        el('clipOutput').classList.remove('hidden');
        Common.toast('Clipboard snippet published on LAN', 'success');
      } catch (e) {
        Common.toast(e.message, 'error');
      }
    };
  }

  window.addEventListener('DOMContentLoaded', init);
})();
