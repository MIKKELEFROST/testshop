import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("om-os");

export default function Page() {
  return <InfoPageView slug="om-os" />;
}
