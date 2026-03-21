import { Helmet } from "react-helmet-async"

type SEOHeadProps = {
  title: string
  description: string
  canonicalUrl?: string
}

export let SEOHead = ({ title, description, canonicalUrl }: SEOHeadProps) => (
  <Helmet>
    <title>{title}</title>
    <meta name="description" content={description} />
    {canonicalUrl && <link rel="canonical" href={`https://sitelytics.tonis.dev${canonicalUrl}`} />}
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
  </Helmet>
)
