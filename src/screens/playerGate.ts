import { normalizeName, randomPlayerName, readPlayer, writePlayer, type PlayerIdentity } from '../player';
import { requestMagicLink } from '../services/supabase';

type Step = 'welcome' | 'claim' | 'register';

export function bindPlayerGate(): void {
  const root = document.getElementById('player-gate');
  const badge = document.getElementById('player-badge');
  const badgeName = document.getElementById('player-badge-name');
  const badgeAnon = document.getElementById('player-badge-anon');
  if (!root || !badge || !badgeName || !badgeAnon) return;

  const welcome = root.querySelector<HTMLElement>('[data-step="welcome"]');
  const claim = root.querySelector<HTMLElement>('[data-step="claim"]');
  const register = root.querySelector<HTMLElement>('[data-step="register"]');
  const nameInput = root.querySelector<HTMLInputElement>('#player-name');
  const claimCopy = root.querySelector<HTMLElement>('[data-claim-copy]');
  const emailInput = root.querySelector<HTMLInputElement>('#player-email');
  const registerMsg = root.querySelector<HTMLElement>('[data-register-msg]');
  const registerBtn = root.querySelector<HTMLButtonElement>('[data-register]');
  if (!welcome || !claim || !register || !nameInput || !claimCopy || !emailInput || !registerMsg || !registerBtn) return;

  let pending = '';

  const paintBadge = (player: PlayerIdentity): void => {
    badgeName.textContent = player.name;
    badgeAnon.hidden = !player.anonymous;
    badge.hidden = false;
  };

  const show = (step: Step): void => {
    welcome.hidden = step !== 'welcome';
    claim.hidden = step !== 'claim';
    register.hidden = step !== 'register';
    root.hidden = false;
    document.body.classList.add('player-gate-open');
    if (step === 'welcome') nameInput.focus();
    if (step === 'register') emailInput.focus();
  };

  const close = (player: PlayerIdentity): void => {
    writePlayer(player);
    paintBadge(player);
    root.hidden = true;
    document.body.classList.remove('player-gate-open');
    const guest = document.getElementById('vs-player-name') as HTMLInputElement | null;
    if (guest) guest.value = player.name;
  };

  const existing = readPlayer();
  if (existing) {
    paintBadge(existing);
    root.hidden = true;
  } else {
    badge.hidden = true;
    show('welcome');
  }

  root.querySelector('[data-join]')?.addEventListener('click', () => {
    pending = normalizeName(nameInput.value) || randomPlayerName();
    claimCopy.textContent = `El apodo ${pending} no está registrado. ¿Lo reclamás como tuyo, o seguís como anónimo?`;
    show('claim');
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      root.querySelector<HTMLButtonElement>('[data-join]')?.click();
    }
  });

  root.querySelector('[data-back-welcome]')?.addEventListener('click', () => show('welcome'));
  root.querySelector('[data-back-claim]')?.addEventListener('click', () => show('claim'));

  root.querySelector('[data-anon]')?.addEventListener('click', () => {
    close({ name: pending, anonymous: true, email: '' });
  });

  root.querySelector('[data-to-register]')?.addEventListener('click', () => {
    registerMsg.hidden = true;
    registerMsg.classList.remove('is-ok');
    show('register');
  });

  registerBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    registerMsg.classList.remove('is-ok');
    if (!email.includes('@')) {
      registerMsg.hidden = false;
      registerMsg.textContent = 'Ingresá un email.';
      return;
    }
    registerBtn.disabled = true;
    const result = await requestMagicLink(email);
    registerBtn.disabled = false;
    if (!result.ok) {
      registerMsg.hidden = false;
      registerMsg.textContent = result.error || 'No se pudo enviar el enlace.';
      return;
    }
    registerMsg.hidden = false;
    registerMsg.classList.add('is-ok');
    registerMsg.textContent = 'Te mandamos un enlace. Abrilo desde el email para quedar con este nombre.';
    window.setTimeout(() => close({ name: pending, anonymous: false, email }), 1600);
  });

  badge.addEventListener('click', () => {
    const player = readPlayer();
    nameInput.value = player?.name || '';
    show('welcome');
  });
}
