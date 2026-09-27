import {
  cancelScheduledDeletion,
  currentAccountEmail,
  currentAccountProfile,
  scheduleAccountDeletion,
  scheduledDeletionDue,
  registerPasskey,
  requestMagicLink,
  signInWithPasskey,
  signOut,
  supabase
} from '../services/supabase';

export function bindAccount(): void {
  const status = document.getElementById('hub-account-status');
  const button = document.getElementById('hub-account-btn');
  if (!status || !button) return;

  const paint = async (): Promise<void> => {
    const email = await currentAccountEmail();
    if (email) {
      status.textContent = `Sesión iniciada como ${email}`;
      button.textContent = 'Tu cuenta';
    } else {
      status.textContent = 'Iniciaste como anónimo.';
      button.textContent = 'Iniciar sesión';
    }
  };

  const profile = document.createElement('dialog');
  profile.className = 'account-dialog';
  profile.innerHTML = `
    <form method="dialog">
      <header class="account-dialog-head">
        <h2>Tu cuenta</h2>
        <button type="button" class="account-dialog-close" data-profile-close aria-label="Cerrar">×</button>
      </header>
      <p class="account-dialog-lead" data-profile-email></p>
      <p class="account-dialog-lead" data-profile-since hidden></p>
      <p class="account-dialog-msg is-info" data-profile-msg hidden></p>
      <div class="account-dialog-actions">
        <button type="button" class="account-btn-ghost" data-profile-passkey>Guardar passkey en este aparato</button>
        <button type="button" class="account-btn-ghost" data-profile-signout>Cerrar sesión</button>
        <button type="button" class="account-btn-danger" data-profile-delete>Eliminar cuenta</button>
      </div>
    </form>`;
  document.body.appendChild(profile);

  const dialog = document.createElement('dialog');
  dialog.className = 'account-dialog';
  dialog.innerHTML = `
    <form method="dialog">
      <header class="account-dialog-head">
        <h2>Iniciar sesión</h2>
        <button type="button" class="account-dialog-close" data-account-close aria-label="Cerrar">×</button>
      </header>
      <p class="account-dialog-lead">Hace falta una cuenta para cargar una canción. Entrá con passkey o con un enlace al email. Podés practicar igual como anónimo.</p>
      <label class="account-field">Email
        <input type="email" name="email" autocomplete="username webauthn" placeholder="tu@email.com" class="vs-input">
      </label>
      <p class="account-dialog-msg" data-account-msg hidden></p>
      <div class="account-dialog-actions">
        <button type="button" class="account-btn-primary" data-account-passkey data-supabase hidden>Entrar con passkey</button>
        <button type="submit" class="account-btn-ghost" data-multiplayer hidden>Enviar enlace al email</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form');
  const msg = dialog.querySelector<HTMLElement>('[data-account-msg]');
  if (!form || !msg) return;

  const showMsg = (text: string): void => {
    msg.hidden = false;
    msg.textContent = text;
  };

  const emailValue = (): string | null => {
    const email = String(new FormData(form).get('email') || '').trim();
    if (!email) {
      showMsg('Ingresá un email.');
      return null;
    }
    return email;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = emailValue();
    if (!email) return;
    const result = await requestMagicLink(email);
    showMsg(result.ok
      ? 'Te mandamos un enlace. Abrilo desde el email para crear la cuenta o entrar. Después podés guardar una passkey.'
      : (result.error || 'No se pudo enviar el enlace.'));
  });

  dialog.querySelector('[data-account-passkey]')?.addEventListener('click', async () => {
    const result = await signInWithPasskey();
    if (!result.ok) {
      showMsg(result.error || 'No se pudo entrar con passkey.');
      return;
    }
    dialog.close();
    await paint();
  });

  button.addEventListener('click', async () => {
    const account = await currentAccountProfile();
    if (account) {
      const emailLine = profile.querySelector<HTMLElement>('[data-profile-email]');
      const sinceLine = profile.querySelector<HTMLElement>('[data-profile-since]');
      const profileMsg = profile.querySelector<HTMLElement>('[data-profile-msg]');
      if (emailLine) emailLine.textContent = account.email;
      if (sinceLine) {
        const created = account.createdAt ? new Date(account.createdAt) : null;
        if (created && !Number.isNaN(created.getTime())) {
          sinceLine.hidden = false;
          sinceLine.textContent = `Cuenta creada el ${created.toLocaleDateString('es')}.`;
        } else {
          sinceLine.hidden = true;
        }
      }
      if (profileMsg) profileMsg.hidden = true;
      profile.showModal();
      return;
    }
    msg.hidden = true;
    dialog.showModal();
  });

  profile.querySelector('[data-profile-close]')?.addEventListener('click', () => profile.close());
  profile.querySelector('[data-profile-passkey]')?.addEventListener('click', async () => {
    const profileMsg = profile.querySelector<HTMLElement>('[data-profile-msg]');
    const result = await registerPasskey();
    if (!profileMsg) return;
    profileMsg.hidden = false;
    profileMsg.textContent = result.ok
      ? 'Passkey guardada. La próxima vez entrá con ella.'
      : (result.error || 'No se pudo guardar la passkey.');
  });
  profile.querySelector('[data-profile-signout]')?.addEventListener('click', async () => {
    await signOut();
    profile.close();
    await paint();
  });
  profile.querySelector('[data-profile-delete]')?.addEventListener('click', async () => {
    const accepted = window.confirm('Tu cuenta se eliminará en 14 días si no volvés a iniciar sesión. ¿Seguir?');
    if (!accepted) return;
    const result = await scheduleAccountDeletion();
    profile.close();
    await paint();
    msg.hidden = false;
    msg.classList.toggle('is-info', result.ok);
    msg.textContent = result.ok
      ? 'Sesión cerrada. Tu cuenta se eliminará en 14 días. Si volvés a entrar, vas a poder restaurarla o dejar que se borre.'
      : (result.error || 'No se pudo programar la eliminación.');
    dialog.showModal();
  });
  dialog.querySelector('[data-account-close]')?.addEventListener('click', () => dialog.close());

  const restore = document.createElement('dialog');
  restore.className = 'account-dialog';
  restore.innerHTML = `
    <form method="dialog">
      <header class="account-dialog-head">
        <h2>Cuenta por borrarse</h2>
      </header>
      <p class="account-dialog-lead" data-restore-lead></p>
      <p class="account-dialog-msg" data-restore-msg hidden></p>
      <div class="account-dialog-actions">
        <button type="button" class="account-btn-primary" data-restore-keep>Restaurar cuenta</button>
        <button type="button" class="account-btn-ghost" data-restore-back>Volver atrás</button>
      </div>
    </form>`;
  document.body.appendChild(restore);
  const restoreLead = restore.querySelector<HTMLElement>('[data-restore-lead]');
  const restoreMsg = restore.querySelector<HTMLElement>('[data-restore-msg]');

  const offerRestore = async (): Promise<void> => {
    const due = await scheduledDeletionDue();
    if (!due || !restoreLead) return;
    const when = new Date(due);
    const label = Number.isNaN(when.getTime()) ? due : when.toLocaleString('es');
    restoreLead.textContent = `Tu cuenta está programada para borrarse el ${label}. Restaurala para seguir usándola, o volvé atrás y se borrará en esa fecha.`;
    if (restoreMsg) restoreMsg.hidden = true;
    if (!restore.open) restore.showModal();
  };

  restore.querySelector('[data-restore-keep]')?.addEventListener('click', async () => {
    const kept = await cancelScheduledDeletion();
    if (!kept) {
      if (restoreMsg) {
        restoreMsg.hidden = false;
        restoreMsg.textContent = 'No se pudo restaurar la cuenta.';
      }
      return;
    }
    restore.close();
    await paint();
  });
  restore.querySelector('[data-restore-back]')?.addEventListener('click', async () => {
    await signOut();
    restore.close();
    await paint();
  });

  supabase.auth.onAuthStateChange((event) => {
    void paint();
    if (event === 'SIGNED_IN') void offerRestore();
  });
  void offerRestore();

  void paint();
}

