import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-shop py-24 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Siden blev ikke fundet</h1>
      <p className="mt-3 text-muted">Produktet eller siden findes ikke længere.</p>
      <div className="mt-8">
        <ButtonLink href="/produkter">Se alle produkter</ButtonLink>
      </div>
    </div>
  );
}
