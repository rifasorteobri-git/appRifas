//función para generar boletos
function generarBoletos(cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 900) {
    throw new Error('cantidad debe ser entero entre 1 y 900');
  }

  const todos = [];
  for (let i = 100; i <= 999; i++) {
    todos.push(String(i)); // "100" a "999"
  }

  // Fisher-Yates shuffle
  for (let i = todos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todos[i], todos[j]] = [todos[j], todos[i]];
  }

  return todos.slice(0, cantidad);
}

async function generarBoletosNuevos(rifaId, cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error('Cantidad inválida');
  }

  // Obtener boletos ya existentes
  const { data: existentes, error } = await supabase
    .from('boletos')
    .select('numero_boleto')
    .eq('rifa_id', rifaId);

  if (error) throw error;

  const usados = new Set(
    existentes.map(b => String(b.numero_boleto))
  );

  const disponibles = [];

  for (let i = 100; i <= 999; i++) {
    const num = String(i);

    if (!usados.has(num)) {
      disponibles.push(num);
    }
  }

  // Mezclar disponibles
  for (let i = disponibles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [disponibles[i], disponibles[j]] =
      [disponibles[j], disponibles[i]];
  }

  return disponibles.slice(0, cantidad);
}


module.exports = {generarBoletos, generarBoletosNuevos};
