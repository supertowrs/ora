export function passwordMinLength(role: 'admin' | 'worker') {
  return role === 'admin' ? 14 : 8;
}

export function passwordError(password: string, role: 'admin' | 'worker') {
  const minimum = passwordMinLength(role);
  return password.length < minimum || password.length > 200
    ? `Usa una contraseña de ${minimum} a 200 caracteres.`
    : null;
}
