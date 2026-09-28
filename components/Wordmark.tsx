/**
 * "Quill & Cup" in the brand serif, colored like the logo: Cup Gray with the Ampersand Pink "&".
 */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold text-cup dark:text-slate-100 ${className}`}>
      Quill <span className="text-ampersand">&amp;</span> Cup
    </span>
  );
}
