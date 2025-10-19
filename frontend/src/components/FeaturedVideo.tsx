import React from "react";

export default function FeaturedVideo({ url }: { url: string }) {
  // Allow either direct video file or an embeddable URL (YouTube etc.)
  const isDirectFile = /\.(mp4|webm|ogg)(\?|$)/i.test(url);

  return (
    <div className="aspect-video w-full overflow-hidden">
      {isDirectFile ? (
        <video src={url} controls preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <iframe
          src={url}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
          loading="lazy"
          title="Featured Video"
        />
      )}
    </div>
  );
}
