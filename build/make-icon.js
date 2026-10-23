// Рисует иконку приложения 512×512 из SVG
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2125"/><stop offset="1" stop-color="#121315"/></linearGradient>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ef0d0"/><stop offset="1" stop-color="#2fbf9a"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy=".45" r=".55"><stop offset="0" stop-color="#3cc9a5" stop-opacity=".22"/><stop offset="1" stop-color="#3cc9a5" stop-opacity="0"/></radialGradient>
</defs>
<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
<rect x="16.5" y="16.5" width="479" height="479" rx="111.5" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#glow)"/>
<g transform="translate(256 256) scale(10) translate(-16 -16)">
  <path d="M9 22.5C9 14 14 9.5 23 9.5M9 22.5c6 0 11-2.5 14-13" stroke="url(#g)" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <circle cx="9" cy="22.5" r="4" fill="url(#g)"/><circle cx="23" cy="9.5" r="4" fill="url(#g)"/>
  <circle cx="16.5" cy="17" r="2.4" fill="#3cc9a5"/>
</g></svg>`;
fs.writeFileSync(__dirname + '/icon.png', new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
console.log('icon.png ok');
