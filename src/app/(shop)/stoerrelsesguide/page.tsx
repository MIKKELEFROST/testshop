import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("stoerrelsesguide");

export default function Page() {
  return <InfoPageView slug="stoerrelsesguide" />;
}
