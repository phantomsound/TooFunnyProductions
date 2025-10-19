import React from "react";

const Hero = () => {
  return (
    <section
      id="home"
      className="bg-gradient-to-r from-brandPrimary to-brandDark text-center py-20 px-4"
    >
      <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-4">
        Comedy that’s <span className="text-brandAccent">Too Funny</span>
      </h1>
      <p className="text-lg text-gray-300 mb-8">
        Original sketch, live shows, and shamelessly fun chaos. Catch us on stage or online.
      </p>
      <div className="flex justify-center space-x-4">
        <a
          href="#events"
          className="bg-brandAccent text-black px-6 py-3 rounded-lg font-semibold shadow hover:bg-yellow-400 transition"
        >
          See Shows
        </a>
        <a
          href="#media"
          className="bg-white text-brandPrimary px-6 py-3 rounded-lg font-semibold shadow hover:bg-gray-200 transition"
        >
          Watch a Clip
        </a>
      </div>
    </section>
  );
};

export default Hero;
