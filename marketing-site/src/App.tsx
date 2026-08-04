import { Routes, Route } from 'react-router-dom';
import Nav from './components/Nav';
import Footer from './components/Footer';
import Home from './pages/Home';
import Pricing from './pages/Pricing';
import PricingSuccess from './pages/PricingSuccess';
import Trust from './pages/Trust';
import Benchmark from './pages/Benchmark';
import Support from './pages/Support';
import Status from './pages/Status';
import Docs from './pages/Docs';
import Blog from './pages/Blog';
import Integrations from './pages/Integrations';
import Faq from './pages/Faq';
import Agents from './pages/Agents';
import NotFound from './pages/NotFound';
import Impressum from './pages/Impressum';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Dpa from './pages/Dpa';

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/pricing/success" element={<PricingSuccess />} />
          <Route path="/trust" element={<Trust />} />
          <Route path="/benchmarks" element={<Benchmark />} />
          <Route path="/support" element={<Support />} />
          <Route path="/status" element={<Status />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/impressum" element={<Impressum />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/dpa" element={<Dpa />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      <script dangerouslySetInnerHTML={{ __html: `window.$crisp=[];window.CRISP_WEBSITE_ID="YOUR_CRISP_WEBSITE_ID";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();` }} />
    </>
  );
}
