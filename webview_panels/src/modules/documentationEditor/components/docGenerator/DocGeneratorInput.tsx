import {
  updateColumnsInCurrentDocsData,
  updateCurrentDocsData,
} from "@modules/documentationEditor/state/documentationSlice";
import { EntityType } from "@modules/documentationEditor/state/entityType";
import {
  DBTDocumentation,
  DBTDocumentationColumn,
  DBTModelTest,
} from "@modules/documentationEditor/state/types";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { isArrayEqual } from "@modules/documentationEditor/utils";
import { panelLogger } from "@modules/logger";
import { Input, InputGroup, Stack, Tag } from "@uicore";
import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { DocumentationPropagationButton } from "../documentationPropagation/DocumentationPropagation";
import DocBlockInserter from "./DocBlockInserter";
import classes from "./docGenInput.module.scss";

interface Props {
  entity: DBTDocumentationColumn | DBTDocumentation;
  placeholder?: string;
  type: EntityType;
  title: string;
  tests?: DBTModelTest[];
}
const DocGeneratorInput = ({
  entity,
  placeholder,
  type,
  title,
  tests,
}: Props): JSX.Element => {
  const stackRef = useRef<HTMLDivElement | null>(null);
  const {
    state: {
      incomingDocsData,
      currentDocsData,
      insertedEntityName,
    },
    dispatch,
  } = useDocumentationContext();
  const [description, setDescription] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [inputRows, setInputRows] = useState(1);

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    let fontSize = 13; // default font size
    try {
      fontSize = parseFloat(window.getComputedStyle(inputRef.current).fontSize);
    } catch (e) {
      panelLogger.error("Error parsing font size", e);
    }
    // generally character width is 0.5 of font size
    const charWidth = fontSize * 0.5;
    const newLines = (description.match(/\n/g) ?? []).length;
    const rows =
      Math.ceil(
        ((description.length - newLines) * charWidth) /
          inputRef.current.clientWidth,
      ) + newLines;
    setInputRows(rows);
  }, [description]);

  useEffect(() => {
    setDescription(entity.description ?? "");
  }, [entity.description]);

  useEffect(() => {
    if (!insertedEntityName || !inputRef.current) {
      return;
    }

    if (insertedEntityName === entity.name) {
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [insertedEntityName, entity.name]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDescription(e.target.value);
    if (type === EntityType.COLUMN) {
      dispatch(
        updateColumnsInCurrentDocsData({
          columns: [{ name: entity.name, description: e.target.value }],
        }),
      );
    }

    if (type === EntityType.MODEL) {
      dispatch(
        updateCurrentDocsData({
          name: entity.name,
          description: e.target.value,
        }),
      );
    }
  };

  const handleInsertDocBlock = (docRef: string) => {
    if (!inputRef.current) {
      return;
    }

    const input = inputRef.current as HTMLTextAreaElement;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const currentValue = description;

    const newValue =
      currentValue.substring(0, start) + docRef + currentValue.substring(end);

    setDescription(newValue);

    // Update Redux state
    if (type === EntityType.COLUMN) {
      dispatch(
        updateColumnsInCurrentDocsData({
          columns: [{ name: entity.name, description: newValue }],
        }),
      );
    }

    if (type === EntityType.MODEL) {
      dispatch(
        updateCurrentDocsData({
          name: entity.name,
          description: newValue,
        }),
      );
    }

    // Set cursor position after the inserted text
    setTimeout(() => {
      if (input) {
        const newCursorPosition = start + docRef.length;
        input.setSelectionRange(newCursorPosition, newCursorPosition);
        input.focus();
      }
    }, 10);
  };

  const entityColumn = incomingDocsData?.docs?.columns?.find(
    (c) => c.name === entity.name,
  );
  const incomingTestKeys = incomingDocsData?.tests
    ?.filter((t) =>
      type === EntityType.MODEL
        ? !t.column_name
        : t.column_name === entity.name,
    )
    .map((t) => t.key);
  const currTestKeys = tests?.map((t) => t.key);
  const isTestsDirty = !isArrayEqual(
    incomingTestKeys ?? [],
    currTestKeys ?? [],
  );
  const isDescriptionDirty =
    type === EntityType.MODEL
      ? currentDocsData?.description !== incomingDocsData?.docs?.description
      : entity.description !== entityColumn?.description;
  const isDirty = isDescriptionDirty || isTestsDirty;

  return (
    <>
      <Stack className="align-items-center mb-2">
        <h4 className="mb-0">{title}</h4>
        {type === EntityType.COLUMN &&
        (entity as DBTDocumentationColumn).type ? (
          <Tag type="rounded">{(entity as DBTDocumentationColumn).type}</Tag>
        ) : null}
        {isDirty ? (
          <Tag color="orange" type="rounded">
            modified
          </Tag>
        ) : null}
        <div className="spacer" />
        <Stack className={classes.actionButtons}>
          <DocBlockInserter
            inputRef={inputRef}
            onInsert={handleInsertDocBlock}
          />
          <DocumentationPropagationButton type={type} name={entity.name} />
        </Stack>
      </Stack>
      <Stack ref={stackRef}>
        <InputGroup className={classes.inputGroup}>
          <Input
            innerRef={inputRef}
            value={description}
            onChange={onChange}
            type="textarea"
            rows={inputRows}
            placeholder={placeholder}
            className={isDescriptionDirty ? "border-orange" : ""}
          />
        </InputGroup>
      </Stack>
    </>
  );
};

export default DocGeneratorInput;
