export const productName = "1Reports";

const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`;

/** The 1Reports logo, split so the collapsed sidebar can keep just the "1R" mark. */
export function Brand() {
  return <span className="brand-wordmark brand-logo" role="img" aria-label={productName}>
    <img className="brand-mark" src={asset("1reports-mark-part.png")} alt="" aria-hidden="true" draggable={false} />
    <img className="brand-copy" src={asset("1reports-wordmark-part.png")} alt="" aria-hidden="true" draggable={false} />
  </span>;
}

/** The full logo, for the sign-in screen. */
export function BrandLogo({ className = "" }: { className?: string }) {
  return <img className={`brand-full-logo ${className}`.trim()} src={asset("1reports-logo.png")} alt={productName}
    width={640} height={171} draggable={false} />;
}
