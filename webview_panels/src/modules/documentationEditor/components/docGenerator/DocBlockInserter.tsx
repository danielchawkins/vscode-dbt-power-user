import {
  PopoverWithButton,
  Stack,
  Button,
  Input,
  activateClickOnKeyDown,
} from "@uicore";
import { RefObject, useState, useMemo } from "react";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { DocBlock } from "@modules/documentationEditor/state/types";
import { HTMLAttributes } from "react";
import { SearchIcon } from "@assets/icons";
import documentationStyles from "../../styles.module.scss";
import styles from "./DocBlockInserter.module.scss";

const DocBlockIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <i className={`codicon codicon-book`} {...props} />
);

interface Props {
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onInsert: (docRef: string) => void;
}

const DocBlockInserter = ({
  inputRef,
  onInsert,
}: Props): JSX.Element | null => {
  const {
    state: { docBlocks },
  } = useDocumentationContext();
  const [searchTerm, setSearchTerm] = useState("");

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const filteredDocBlocks = useMemo(() => {
    if (!searchTerm.trim()) {
      return docBlocks;
    }
    return docBlocks.filter(
      (docBlock) =>
        docBlock.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        docBlock.path.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [docBlocks, searchTerm]);

  if (!docBlocks.length) {
    return null;
  }

  const handleInsertDocBlock = (docBlock: DocBlock, close: () => void) => {
    const docRef = `{{ doc('${docBlock.name}') }}`;
    onInsert(docRef);
    close();

    // Focus back to the input after insertion
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  return (
    <PopoverWithButton
      button={
        <Button
          color="primary"
          title="Insert doc block reference"
          data-testid="doc-block-inserter"
        >
          <DocBlockIcon />
        </Button>
      }
      title="Insert Doc Block Reference"
    >
      {({ close }) => (
        <Stack direction="column" className={styles.popoverContent}>
          <Stack className={`${documentationStyles.search} ${styles.searchContainer}`}>
            <SearchIcon />
            <Input
              placeholder="Search doc blocks..."
              value={searchTerm}
              onChange={handleSearchChange}
              type="search"
            />
          </Stack>
          <div className={styles.itemsList}>
            {filteredDocBlocks.length > 0 ? (
              filteredDocBlocks.map((docBlock) => (
                <div
                  key={docBlock.name}
                  className={styles.docBlockItem}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleInsertDocBlock(docBlock, close)}
                  onKeyDown={(e) =>
                    activateClickOnKeyDown(e, () =>
                      handleInsertDocBlock(docBlock, close),
                    )
                  }
                >
                  <Stack direction="column" className={`align-items-start ${styles.itemContent}`}>
                    <strong className={styles.itemName}>{docBlock.name}</strong>
                  </Stack>
                </div>
              ))
            ) : (
              <div className={`text-muted text-center ${styles.emptyState}`}>
                No doc blocks found matching &quot;{searchTerm}&quot;
              </div>
            )}
          </div>
        </Stack>
      )}
    </PopoverWithButton>
  );
};

export default DocBlockInserter;
