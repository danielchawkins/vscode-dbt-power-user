import { FilterIcon, SearchIcon } from "@assets/icons";
import { useDebouncedValue } from "@modules/app/useDebouncedValue";
import { IconButton, Input, MultiSelect, Stack } from "@uicore";
import type { ChangeEvent, MouseEvent } from "react";
import { useEffect, useEffectEvent, useState } from "react";
import styles from "../../querypanel.module.css";

export interface QueryFilters {
  tags: string[];
  searchQuery?: string | undefined;
}

interface Props {
  tags: string[];
  filters: QueryFilters;
  onFiltersChange: (data: { tags?: string[]; searchQuery?: string }) => void;
}
const Filters = ({
  filters: { tags: selectedTags, searchQuery },
  tags,
  onFiltersChange,
}: Props): React.JSX.Element | null => {
  const [text, setText] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const value = useDebouncedValue(text, 1000);

  const stopPropagation = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const applySearch = useEffectEvent((query: string) => {
    if (query === searchQuery) {
      return;
    }
    onFiltersChange({ searchQuery: query });
  });

  useEffect(() => {
    applySearch(value);
  }, [value]);

  const handleSearchQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const handleBlur = () => {
    if (searchQuery) {
      return;
    }
    setShowSearch(false);
  };

  const handleTagsBlur = () => {
    if (selectedTags.length) {
      return;
    }
    setShowForm(false);
  };

  const handleTagsChange = (changedTags: string[]) => {
    onFiltersChange({ tags: changedTags });
  };

  return (
    <>
      {/* oxlint-disable-next-line jsx_a11y/no-static-element-interactions, jsx_a11y/click-events-have-key-events -- nested controls own keyboard behavior; wrapper stops parent accordion click */}
      <Stack className="gap-1" onClick={stopPropagation}>
        {showSearch ? (
          <Input
            type="search"
            placeholder="Search query"
            onChange={handleSearchQueryChange}
            onBlur={handleBlur}
            // oxlint-disable-next-line jsx_a11y/no-autofocus -- the field appears because the user clicked Search
            autoFocus
            style={{ marginBottom: 4.5, maxHeight: 38 }}
            className={styles.searchInput}
          />
        ) : (
          <IconButton title="Search query" onClick={() => setShowSearch(true)}>
            <SearchIcon />
          </IconButton>
        )}
        {showForm ? (
          <MultiSelect
            // oxlint-disable-next-line jsx_a11y/no-autofocus -- the list appears because the user clicked Filter
            autoFocus
            id="tags"
            style={{ minWidth: 200, marginBottom: "1rem" }}
            options={tags.map((v) => ({ label: v, value: v }))}
            value={selectedTags}
            onChange={handleTagsChange}
            onBlur={handleTagsBlur}
          />
        ) : tags.length ? (
          <IconButton title="Search query" onClick={() => setShowForm(true)}>
            <FilterIcon />
          </IconButton>
        ) : null}
      </Stack>
    </>
  );
};

export default Filters;
