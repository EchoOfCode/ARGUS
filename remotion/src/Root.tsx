import { Composition } from "remotion";
import { ArgusDemo } from "./ArgusDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ArgusDemo"
        component={ArgusDemo}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
