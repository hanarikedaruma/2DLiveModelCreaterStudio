import { useState } from 'react';
import { useDialogs, useDispatch, useEditor, useProject } from '../../../shell/api';
import { MOUTH_PARAMETERS, registerVowelCommand, standardVowelsCommand, VOWEL_CHOICES, type Vowel } from './commands';
import './vowels.css';

export function VowelPanel() {
  const project = useProject();
  const [editor, setEditor] = useEditor();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const [selected, setSelected] = useState<Vowel>('a');
  const vowels = project.model.lipSync.vowels;
  const parameters = project.model.parameters.filter((p) => MOUTH_PARAMETERS.some((id) => id === p.id));
  const choose = (vowel: Vowel) => {
    setSelected(vowel);
    const values = vowels.find((v) => v.vowel === vowel)?.values ?? {};
    setEditor({
      activeParameterIds: [],
      editorParamValues: {
        ...editor.editorParamValues,
        ...Object.fromEntries(parameters.map((p) => [p.id, values[p.id] ?? p.default])),
      },
    });
  };
  return (
    <div className="vowel-panel">
      <label>
        母音
        <select aria-label="母音" value={selected} onChange={(e) => choose(e.target.value as Vowel)}>
          {VOWEL_CHOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {vowels.some((x) => x.vowel === v.id) ? '（登録済み）' : ''}
            </option>
          ))}
        </select>
      </label>
      {parameters.map((p) => (
        <label className="vowel-value" key={p.id}>
          <span>{p.name}</span>
          <input
            type="range"
            aria-label={p.name}
            min={p.min}
            max={p.max}
            step={0.01}
            value={editor.editorParamValues[p.id] ?? p.default}
            onChange={(e) =>
              setEditor({
                activeParameterIds: [],
                editorParamValues: { ...editor.editorParamValues, [p.id]: Number(e.target.value) },
              })
            }
          />
          <output>{(editor.editorParamValues[p.id] ?? p.default).toFixed(2)}</output>
        </label>
      ))}
      <button
        type="button"
        disabled={parameters.length === 0}
        onClick={() => dispatch(registerVowelCommand(selected, editor.editorParamValues))}
      >
        この形を登録
      </button>
      <button
        type="button"
        disabled={parameters.length === 0}
        onClick={async () => {
          if (vowels.length > 0 && !(await dialogs.confirm('登録した母音の形を標準の形で上書きしますか？'))) return;
          dispatch(standardVowelsCommand());
        }}
      >
        標準の形で作る
      </button>
    </div>
  );
}
