import { useEffect } from "react";

/** A full-size image over the page. Click or Escape closes it. */
export default function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <button className="lightbox" type="button" aria-label="이미지 닫기" onClick={onClose}>
      <img src={src} alt={alt} />
    </button>
  );
}
