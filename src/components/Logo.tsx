/** A logo redonda da pizzaria (public/logo.png, gerada por scripts/marca.mjs). */
export function Marca({ className = 'size-11' }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={`${className} shrink-0 rounded-full`} />
}

export function Logo({ claro = false, url }: { claro?: boolean; url?: string | null }) {
  // logo enviada pelo painel (Conteúdo → Aparência) substitui a marca padrão
  if (url) return <img src={url} alt="Tia Cê Pizzas" className="h-10 w-auto max-w-[12rem] object-contain" />
  return (
    <span className="inline-flex items-center gap-2.5">
      <Marca />
      <span className={`font-display text-2xl leading-none font-bold ${claro ? 'text-massa-50' : 'text-forno-900'}`}>
        Tia Cê <span className={claro ? 'text-queijo-400' : 'text-molho-600'}>Pizzas</span>
      </span>
    </span>
  )
}

/** Pizza ilustrada da capa do site. */
export function PizzaIlustrada({ className }: { className?: string }) {
  const pepperoni = [
    [150, 120], [255, 105], [300, 190], [110, 215], [205, 200], [160, 300], [270, 285], [215, 130],
  ]
  const manjericao = [
    [190, 90, 20], [120, 160, -30], [250, 160, 40], [320, 250, -10], [215, 260, 60], [120, 270, 10], [200, 330, -40],
  ]
  const azeitonas = [
    [300, 130], [95, 180], [170, 240], [250, 330], [330, 215], [180, 160],
  ]
  return (
    <svg viewBox="0 0 400 400" className={className} role="img" aria-label="Pizza recém-saída do forno">
      <circle cx="200" cy="208" r="188" fill="#261912" opacity=".18" />
      <circle cx="200" cy="200" r="188" fill="#c98f4e" />
      <circle cx="200" cy="200" r="184" fill="#dcb377" />
      <circle cx="200" cy="200" r="160" fill="#b8301a" />
      <circle cx="200" cy="200" r="152" fill="#f0b93f" />
      <g fill="#f6cf74" opacity=".8">
        <ellipse cx="140" cy="150" rx="46" ry="30" transform="rotate(-25 140 150)" />
        <ellipse cx="265" cy="235" rx="52" ry="34" transform="rotate(30 265 235)" />
        <ellipse cx="170" cy="275" rx="40" ry="26" transform="rotate(-10 170 275)" />
        <ellipse cx="265" cy="130" rx="34" ry="22" transform="rotate(15 265 130)" />
      </g>
      {pepperoni.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="24" fill="#a02a17" />
          <circle cx={x - 6} cy={y - 6} r="4" fill="#c0351d" />
          <circle cx={x + 8} cy={y + 4} r="3" fill="#842617" />
        </g>
      ))}
      {azeitonas.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="9" fill="#261912" />
          <circle cx={x} cy={y} r="3.5" fill="#f0b93f" />
        </g>
      ))}
      {manjericao.map(([x, y, r], i) => (
        <path key={i} d="M0 -16 C 12 -10, 12 10, 0 16 C -12 10, -12 -10, 0 -16 Z" fill="#3f7a3a" transform={`translate(${x} ${y}) rotate(${r})`} />
      ))}
    </svg>
  )
}
