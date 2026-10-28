import type { documentationEditor } from "@fusion-power-user/webview-contract";
import { InfoCircleIcon, TestsIcon } from "@assets/icons";
import type { EntityType } from "@modules/documentationEditor/state/entityType";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import type { DrawerRef } from "@uicore";
import { Button, Drawer, Stack, Tooltip } from "@uicore";
import { useMemo, useRef, useState } from "react";
import classes from "../../styles.module.css";
import AddTest from "./AddTest";
import DisplayTestDetails from "./DisplayTestDetails";
import Test from "./Test";

interface Props {
  title: string;
  tests?: documentationEditor.ModelTest[] | undefined;
  type: EntityType;
}

const MaxVisibleTests = 3;

const EntityWithTests = ({
  title,
  tests,
  type,
}: Props): React.JSX.Element | null => {
  const {
    state: { incomingDocsData },
  } = useDocumentationContext();
  const [selectedTest, setSelectedTest] = useState<documentationEditor.ModelTest | null>(null);
  const [showAllTests, setShowAllTests] = useState(false);
  const drawerRef = useRef<DrawerRef | null>(null);
  const handleClose = () => {
    setSelectedTest(null);
    drawerRef.current?.close();
  };

  const handleShowAllTests = () => setShowAllTests(true);

  const onSelect = (test: documentationEditor.ModelTest) => {
    setSelectedTest(test);
    drawerRef.current?.open();
  };

  const currentTests = useMemo(
    () =>
      tests
        ?.map((t) => t.test_metadata?.name)
        .filter((item): item is string => !!item),
    [tests],
  );

  const visibleTests = showAllTests
    ? tests
    : (tests ?? []).slice(0, MaxVisibleTests);
  const remainingTests = (tests ?? []).length - MaxVisibleTests;
  const testKeys = incomingDocsData?.tests?.map((t) => t.key);

  return (
    <div className={classes.entityTests}>
      <Stack className={type}>
        <div className={classes.testsRow}>
          <p className="mb-0 d-inline">
            <TestsIcon /> Data Tests:
            <Tooltip
              title={
                <>
                  Schema and data quality checks that validate your model&apos;s
                  output (e.g. not_null, unique, accepted_values).{" "}
                  <a
                    href="https://docs.getdbt.com/docs/build/data-tests"
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
            <Test
              key={test.key}
              test={test}
              onSelect={onSelect}
              selectedTest={selectedTest}
              className={!testKeys?.includes(test.key) ? "border-orange" : ""}
            />
          ))}
          {!showAllTests && tests && tests.length > MaxVisibleTests ? (
            <Button
              outline
              onClick={handleShowAllTests}
              className={classes.showAllTests}
              title={`Show all tests`}
            >
              {remainingTests} {remainingTests > 1 ? "tests" : "test"} +
            </Button>
          ) : null}
          <AddTest title={title} currentTests={currentTests} type={type} />
        </div>
      </Stack>
      <Drawer ref={drawerRef} onClose={handleClose}>
        {selectedTest ? (
          <DisplayTestDetails
            onClose={handleClose}
            test={selectedTest}
            column={title}
            type={type}
          />
        ) : null}
      </Drawer>
    </div>
  );
};

export default EntityWithTests;
