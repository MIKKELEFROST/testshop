import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("fortrydelsesret");

export default function Page() {
  return <InfoPageView slug="fortrydelsesret" />;
}
