import { InfoCircleIcon } from "@assets/icons";
import { Alert } from "@uicore";
import { useEffect, useState } from "react";

const AutoCollapsingNotification = ({
  text,
  delay,
}: {
  text: string;
  delay: number;
}): React.JSX.Element => {
  const [showInfo, setShowInfo] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowInfo(false), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <Alert
      color="warning"
      onClick={() => setShowInfo((prevSetinfo) => !prevSetinfo)}
      className="d-flex align-items-center cursor-pointer gap-sm m-0 p-2"
    >
      <InfoCircleIcon />
      {showInfo && text}
    </Alert>
  );
};

export default AutoCollapsingNotification;
