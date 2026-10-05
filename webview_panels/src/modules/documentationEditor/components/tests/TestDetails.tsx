import {
  DbtGenericTests,
  DBTModelTest,
  DbtTestTypes,
  TestMetadataAcceptedValuesKwArgs,
  TestMetadataRelationshipsKwArgs,
} from "@modules/documentationEditor/state/types";
import {
  Card,
  CardBody,
  CardTitle,
  Label,
  ListGroup,
  ListGroupItem,
  Stack,
} from "@uicore";
import { useMemo } from "react";
import classes from "../../styles.module.css";
import DbtTestCode from "./DbtTestCode";

interface Props {
  testType: DbtTestTypes;
  test: DBTModelTest;
}

const TestDetails = ({ testType, test }: Props): JSX.Element => {
  const testConfig = useMemo(() => {
    switch (testType) {
      case DbtTestTypes.GENERIC:
        switch (test.test_metadata?.name) {
          case DbtGenericTests.ACCEPTED_VALUES:
            return (
              <Card>
                <CardBody>
                  <CardTitle className="d-flex justify-content-between">
                    Values
                  </CardTitle>
                  <ListGroup className={classes.testListGroup}>
                    {(
                      test.test_metadata
                        .kwargs as TestMetadataAcceptedValuesKwArgs
                    ).values?.map((value) => (
                      <ListGroupItem key={value}>
                        {value}
                      </ListGroupItem>
                    ))}
                  </ListGroup>
                </CardBody>
              </Card>
            );
          case DbtGenericTests.RELATIONSHIPS:
            return (
              <Card>
                <CardBody>
                  <CardTitle className="d-flex justify-content-between">
                    Values
                  </CardTitle>
                  <Stack direction="column">
                    <div>
                      <Label>To:</Label>
                      <div
                        className="p-2 px-3 rounded"
                        style={{ background: "var(--vscode-textCodeBlock-background)" }}
                      >
                        {
                          (
                            test.test_metadata
                              .kwargs as TestMetadataRelationshipsKwArgs
                          ).to
                        }
                      </div>
                    </div>
                    <div>
                      <Label>Field:</Label>
                      <div
                        className="p-2 px-3 rounded"
                        style={{ background: "var(--vscode-textCodeBlock-background)" }}
                      >
                        {
                          (
                            test.test_metadata
                              .kwargs as TestMetadataRelationshipsKwArgs
                          ).field
                        }
                      </div>
                    </div>
                  </Stack>
                </CardBody>
              </Card>
            );

          case undefined:
          default:
            break;
        }
        break;
      case DbtTestTypes.EXTERNAL_PACKAGE:
      case DbtTestTypes.MACRO:
      case DbtTestTypes.SINGULAR:
      case DbtTestTypes.UNKNOWN:
        break;
    }
    return null;
  }, [testType, test.test_metadata]);

  return (
    <Stack direction="column">
      {testConfig}
      <DbtTestCode test={test} />
    </Stack>
  );
};

export default TestDetails;
