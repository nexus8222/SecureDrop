/**
 * SecureDrop LAN — Receive Terminal Engine
 */

(function () {
  const el = (id) => document.getElementById(id);

  async function init() {
    await Common.initNavigation('receive');
    setupPinInputs();
    setupLinkInput();
  }

  function setupPinInputs() {
    const inputs = [el('p1'), el('p2'), el('p3'), el('p4')];

    inputs.forEach((input, index) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val;
        if (val && index < 3) {
          inputs[index + 1].focus();
        }
        if (inputs.every(i => i.value.length === 1)) {
          resolvePin();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) {
          inputs[index - 1].focus();
        }
        if (e.key === 'Enter') {
          resolvePin();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').trim();
        const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
        digits.split('').forEach((d, i) => {
          if (inputs[i]) inputs[i].value = d;
        });
        if (digits.length === 4) {
          inputs[3].focus();
          resolvePin();
        } else if (digits.length > 0 && digits.length < 4) {
          inputs[digits.length].focus();
        }
      });
    });

    el('resolvePinBtn').onclick = resolvePin;
    el('clearPinBtn').onclick = () => {
      inputs.forEach(i => i.value = '');
      inputs[0].focus();
      el('pinStatusText').textContent = '';
    };
  }

  async function resolvePin() {
    const inputs = [el('p1'), el('p2'), el('p3'), el('p4')];
    const pin = inputs.map(i => i.value).join('');

    if (pin.length !== 4) {
      return Common.toast('Enter all 4 digits of the PIN', 'error');
    }

    const status = el('pinStatusText');
    status.textContent = `Connecting to PIN ${pin}...`;

    try {
      const res = await Common.api(`/api/shares/by-pin/${pin}`);
      status.textContent = `Found share "${res.title}". Loading...`;
      Common.toast(`Connected to share: ${res.title}`, 'success');
      setTimeout(() => {
        window.location.href = `/share/${res.token}`;
      }, 400);
    } catch (e) {
      status.textContent = `PIN not found or share expired`;
      Common.toast(`Error: ${e.message}`, 'error', 5000);
      inputs.forEach(i => i.value = '');
      inputs[0].focus();
    }
  }

  function setupLinkInput() {
    el('pasteBtn').onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        el('linkInput').value = text;
      } catch {
        Common.toast('Clipboard permission denied; paste manually', 'error');
      }
    };

    el('loadLinkBtn').onclick = () => {
      const raw = el('linkInput').value.trim();
      if (!raw) return Common.toast('Paste a link or token first', 'error');

      // Check if it's a full URL or just a token
      try {
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
          const url = new URL(raw);
          const match = url.pathname.match(/\/share\/([^\/]+)/);
          if (match) {
            window.location.href = `/share/${match[1]}${url.hash}`;
            return;
          }
        }
      } catch {}

      // If token directly
      const token = raw.replace(/^#/, '').split('/')[0];
      window.location.href = `/share/${token}`;
    };

    el('linkInput').onkeydown = (e) => {
      if (e.key === 'Enter') el('loadLinkBtn').click();
    };
  }

  window.addEventListener('DOMContentLoaded', init);
})();
