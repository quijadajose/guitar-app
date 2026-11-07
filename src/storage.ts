/**
 * Acceso a localStorage que no revienta. En modo privado, con el almacenamiento lleno
 * o con cookies bloqueadas, localStorage lanza excepción: la app sigue funcionando sin guardar.
 */
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nada que borrar si el almacenamiento no está disponible.
  }
}
