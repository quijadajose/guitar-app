import { normalizeName, randomPlayerName, readPlayer, writePlayer, type PlayerIdentity } from '../player';

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
  const passInput = root.querySelector<HTMLInputElement>('#player-pass');
  const passAgain = root.querySelector<HTMLInputElement>('#player-pass-again');
  const registerMsg = root.querySelector<HTMLElement>('[data-register-msg]');
  if (!welcome || !claim || !register || !nameInput || !claimCopy || !emailInput || !passInput || !passAgain || !registerMsg) return;

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
    passInput.value = '';
    passAgain.value = '';
    show('register');
  });

  root.querySelector('[data-register]')?.addEventListener('click', () => {
    const pass = passInput.value;
    const again = passAgain.value;
    if (pass.length < 4) {
      registerMsg.hidden = false;
      registerMsg.textContent = 'La contraseña necesita al menos 4 caracteres.';
      return;
    }
    if (pass !== again) {
      registerMsg.hidden = false;
      registerMsg.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    close({ name: pending, anonymous: false, email: emailInput.value.trim() });
  });

  badge.addEventListener('click', () => {
    const player = readPlayer();
    nameInput.value = player?.name || '';
    show('welcome');
  });
}
