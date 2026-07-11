import React from 'react';
import Navbar from '../../components/Navbar/Navbar';
import Pricing from '../../components/Pricing/Pricing';
import Footer from '../../components/Footer/Footer';

/**
 * Standalone Pricing page — same Navbar + Footer as the landing,
 * with the existing Pricing section as the main content. Lives at /pricing
 * so the landing can stay focused on product positioning.
 */
const PricingPage: React.FC = () => {
  return (
    <div className="app">
      <Navbar />
      <main>
        <Pricing />
      </main>
      <Footer />
    </div>
  );
};

export default PricingPage;
