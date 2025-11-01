import React from "react";

type PageContainerProps = {
  /** Optional additional class names appended after the base layout classes. */
  className?: string;
  /** Children to render inside the constrained container. */
  children: React.ReactNode;
  /** Disable the default vertical padding when custom spacing is needed. */
  padded?: boolean;
  /** Allow the content to span the full width without horizontal padding. */
  bleed?: boolean;
};

const HORIZONTAL_CLASSES = "px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 2xl:px-16";
const VERTICAL_CLASSES = "py-10 sm:py-12 lg:py-16";

const PageContainer: React.FC<PageContainerProps> = ({
  className = "",
  children,
  padded = true,
  bleed = false,
}) => {
  const classes = [
    "mx-auto w-full max-w-screen-xl",
    bleed ? "" : HORIZONTAL_CLASSES,
    padded ? VERTICAL_CLASSES : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
};

export default PageContainer;
