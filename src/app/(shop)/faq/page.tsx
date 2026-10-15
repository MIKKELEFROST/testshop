import { InfoPageView, infoMetadata } from "@/components/content/info-page";

export const generateMetadata = () => infoMetadata("faq");

export default function Page() {
  return <InfoPageView slug="faq" />;
}
