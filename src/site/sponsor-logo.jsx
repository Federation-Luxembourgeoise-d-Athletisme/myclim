import { useEffect, useRef, useState } from "react";
import { computeLogoSize, getSponsorMediaSettings, getSponsorMediaStyle } from "./sponsor-media-utils";

/**
 * A partner logo sized to the same visual weight as its neighbours.
 * It measures its parent box, so the same logo looks balanced in every grid
 * (home page, partners page, links page, admin preview).
 * Logos set to "cover" keep the old fill-the-box behaviour.
 */
export function SponsorLogo({ sponsor, alt }) {
  const imageRef = useRef(null);
  const [ratio, setRatio] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const { logoFit, logoScale } = getSponsorMediaSettings(sponsor);
  const isCover = logoFit === "cover";

  useEffect(() => {
    const parent = imageRef.current?.parentElement;
    if (!parent || isCover || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [isCover]);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth && image.naturalHeight) {
      setRatio(image.naturalWidth / image.naturalHeight);
    }
  }, [sponsor.logoUrl]);

  function handleLoad(event) {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight);
  }

  const size = isCover
    ? null
    : computeLogoSize({ boxWidth: box.width, boxHeight: box.height, ratio, scale: logoScale });

  const style = size
    ? { width: size.width, height: size.height, maxWidth: "none", maxHeight: "none", objectFit: "contain", transform: "none" }
    : getSponsorMediaStyle(sponsor);

  return <img ref={imageRef} src={sponsor.logoUrl} alt={alt ?? sponsor.name ?? ""} style={style} onLoad={handleLoad} />;
}
