import { Helmet } from "react-helmet-async"

export let Login = () => (
  <div className="login-page">
    <Helmet><title>Sitelytics - Login</title></Helmet>
    <div className="login-box">
      <h1>Sitelytics</h1>
      <p className="login-subtitle">Google Search Console and Analytics in one view</p>
      <a href="/auth/google" className="google-btn">Sign in with Google</a>
    </div>
  </div>
)
