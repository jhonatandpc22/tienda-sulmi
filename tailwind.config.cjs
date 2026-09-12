module.exports = {
  content: ['./index.html', './assets/*.js'],
  theme: { extend: { colors: { yape: '#742284', tarjeta: '#2563eb', impresion: '#0ea5e9', bcp: '#ff7a00' } } },
  safelist: [{pattern: /^(bg|text|border)-(slate|red|emerald|indigo|sky|pink|amber|rose|purple|blue|orange|green|yellow|teal|cyan|violet)-(100|200|300|400|500|600|700|800|900|950)(\/10|\/20|\/30|\/40|\/50)?$/}],
};
