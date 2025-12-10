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


module.exports = generarBoletos;
