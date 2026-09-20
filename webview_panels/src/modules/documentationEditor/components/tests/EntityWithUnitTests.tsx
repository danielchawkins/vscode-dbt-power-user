import { InfoCircleIcon } from "@assets/icons";
import { EntityType } from "@modules/documentationEditor/state/entityType";
import { DBTUnitTest } from "@modules/documentationEditor/state/types";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { Button, Drawer, DrawerRef, Stack, Tag, Tooltip } from "@uicore";
import { useRef, useState } from "react";
import classes from "../../styles.module.scss";
import UnitTestDetails from "./UnitTestDetails";

interface Props {
  title: string;
  unitTests?: DBTUnitTest[];
}

const MaxVisibleUnitTests = 3;

const EntityWithUnitTests = ({ title, unitTests }: Props): JSX.Element => {
  const {
    state: { currentDocsData },
  } = useDocumentationContext();
  const [showAllTests, setShowAllTests] = useState(false);
  const [selectedTest, setSelectedTest] = useState<DBTUnitTest | null>(null);
  const drawerRef = useRef<DrawerRef | null>(null);

  const handleClose = () => {
    setSelectedTest(null);
    drawerRef.current?.close();
  };

  const onSelect = (test: DBTUnitTest) => {
    setSelectedTest(test);
    drawerRef.current?.open();
  };

  const visibleTests = showAllTests
    ? unitTests
    : (unitTests ?? []).slice(0, MaxVisibleUnitTests);
  const remainingTests = (unitTests ?? []).length - MaxVisibleUnitTests;

  return (
    <>
      <div className={classes.entityTests} style={{ marginTop: "-1rem" }}>
        <Stack className={EntityType.MODEL}>
          <div className={classes.testsRow}>
            <p className="mb-0 d-inline">
              Unit Tests:
              <Tooltip
                autohide={false}
                title={
                  <>
                    Business logic tests that validate your model&apos;s
                    transformation with mocked inputs and expected outputs (dbt
                    1.8+).{" "}
                    <a
                      href="https://docs.getdbt.com/docs/build/unit-tests"
                      target="_blank"
                      rel="noreferrer"
                    >
                      dbt docs ↗
                    </a>
                  </>
                }
              >
                <InfoCircleIcon
                  style={{ marginLeft: 4, cursor: "help", opacity: 0.6 }}
                />
              </Tooltip>
            </p>
            {visibleTests?.map((test) => (
              <Tooltip
                key={test.name}
                title={"Click to view details"}
                id={`tooltip-${test.name}`}
              >
                <Tag
                  color={
                    selectedTest?.name === test.name ? "primary" : "default"
                  }
                  key={test.name}
                  className={`badge ${classes.newTestTag}`}
                  onClick={() => onSelect(test)}
                >
                  {test.name}
                </Tag>
              </Tooltip>
            ))}
            {!showAllTests &&
            unitTests &&
            unitTests.length > MaxVisibleUnitTests ? (
              <Button
                outline
                onClick={() => setShowAllTests(true)}
                className={classes.showAllTests}
                title="Show all unit tests"
              >
                {remainingTests} {remainingTests > 1 ? "tests" : "test"} +
              </Button>
            ) : null}
          </div>
        </Stack>
      </div>
      <Drawer ref={drawerRef} onClose={handleClose}>
        {selectedTest ? (
          <UnitTestDetails
            test={selectedTest}
            modelName={currentDocsData?.name ?? title}
          />
        ) : null}
      </Drawer>
    </>
  );
};

export default EntityWithUnitTests;
