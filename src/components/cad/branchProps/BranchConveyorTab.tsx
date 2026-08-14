import {
  SectionHeader, EditInput, SelectField, CheckField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

/**
 * Вкладка «Конвейер» панели свойств ветви.
 * Перенос 1:1 из BranchPropsPanel — разметка и логика не менялись
 * (поля пока только отображаются и ничего не сохраняют, как и было).
 */
export default function BranchConveyorTab() {
  return (
    <div>
      <SectionHeader title="Параметры конвейера" />
      <InlineLabel label="Конвейер установлен">
        <CheckField checked={false} onChange={() => {}} />
      </InlineLabel>
      <InlineLabel label="Тип конвейера">
        <SelectField
          value="Ленточный"
          options={["Ленточный", "Скребковый", "Пластинчатый"]}
          onChange={() => {}}
        />
      </InlineLabel>
      <InlineLabel label="Производительность, т/ч">
        <EditInput type="number" step="10" value={0} onChange={() => {}} />
      </InlineLabel>
    </div>
  );
}
