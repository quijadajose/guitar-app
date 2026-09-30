import { normalizeName, randomPlayerName, readPlayer, writePlayer, type PlayerIdentity } from '../player';
import { requestMagicLink, scheduleAccountDeletion, signOut, supabase } from '../services/supabase';

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
    window.dispatchEvent(new CustomEvent('player-ready'));
  };

  const existing = readPlayer();
  if (existing?.anonymous) {
    paintBadge(existing);
    root.hidden = true;
  } else {
    badge.hidden = true;
    show('welcome');
  }

  void supabase.auth.getSession().then(({ data }) => {
    if (!data.session) return;
    const player = readPlayer();
    if (!player) return;
    close({ ...player, anonymous: false, email: data.session.user.email || player.email });
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event !== 'SIGNED_IN' || !session) return;
    const name = pending || readPlayer()?.name;
    if (!name) return;
    close({
      name,
      anonymous: false,
      email: session.user.email || emailInput.value.trim()
    });
  });

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
    registerMsg.textContent = 'Te mandamos un enlace. Esta pantalla sigue hasta que lo abras y entres.';
  });

  const menu = document.getElementById('player-menu') as HTMLDialogElement | null;
  const menuTitle = menu?.querySelector<HTMLElement>('[data-menu-title]');
  const menuCopy = menu?.querySelector<HTMLElement>('[data-menu-copy]');
  const menuMsg = menu?.querySelector<HTMLElement>('[data-menu-msg]');
  const menuAnon = menu?.querySelector<HTMLElement>('[data-menu-anon]');
  const menuAccount = menu?.querySelector<HTMLElement>('[data-menu-account]');

  const openMenu = (): void => {
    const player = readPlayer();
    if (!menu || !player || !menuTitle || !menuCopy || !menuAnon || !menuAccount) return;
    if (menuMsg) menuMsg.hidden = true;
    const registered = !player.anonymous;
    menuTitle.textContent = player.name;
    menuAnon.hidden = registered;
    menuAccount.hidden = !registered;
    menuCopy.textContent = registered
      ? 'Estás con una cuenta registrada.'
      : 'Estás jugando como anónimo. Cambiá de usuario para elegir otro nombre o registrar este.';
    if (!menu.open) menu.showModal();
  };

  menu?.querySelector('[data-menu-close]')?.addEventListener('click', () => menu.close());
  menu?.querySelector('[data-menu-change]')?.addEventListener('click', () => {
    menu?.close();
    const player = readPlayer();
    nameInput.value = player?.name || '';
    show('welcome');
  });
  menu?.querySelector('[data-menu-signout]')?.addEventListener('click', async () => {
    await signOut();
    const player = readPlayer();
    if (player) close({ ...player, anonymous: true, email: '' });
    menu?.close();
  });
  const deleteDialog = document.getElementById('player-delete-dialog') as HTMLDialogElement | null;
  const closeDeleteDialog = (): void => deleteDialog?.close();
  deleteDialog?.querySelectorAll('[data-delete-cancel]').forEach((button) => {
    button.addEventListener('click', closeDeleteDialog);
  });
  menu?.querySelector('[data-menu-delete]')?.addEventListener('click', () => {
    if (deleteDialog && !deleteDialog.open) deleteDialog.showModal();
  });
  deleteDialog?.querySelector('[data-delete-confirm]')?.addEventListener('click', async () => {
    deleteDialog.close();
    const result = await scheduleAccountDeletion();
    const player = readPlayer();
    if (player) close({ ...player, anonymous: true, email: '' });
    if (menuMsg) {
      menuMsg.hidden = false;
      menuMsg.textContent = result.ok
        ? 'Sesión cerrada. La cuenta se elimina en 14 días. Si volvés a entrar, vas a poder restaurarla.'
        : (result.error || 'No se pudo programar la eliminación.');
    }
    if (result.ok && menuAnon && menuAccount && menuCopy) {
      menuAnon.hidden = false;
      menuAccount.hidden = true;
      menuCopy.textContent = 'Quedaste como anónimo.';
    }
  });

  badge.addEventListener('click', () => openMenu());
}
