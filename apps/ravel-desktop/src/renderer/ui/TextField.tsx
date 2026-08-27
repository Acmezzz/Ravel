import * as React from "react";
import { cn } from "./utils";

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "onChange" | "onBlur" | "onKeyDown" | "children"> {
	label?: string;
	hint?: string;
	error?: string;
	multiline?: boolean;
	minRows?: number;
	select?: boolean;
	children?: React.ReactNode;
	onChange?: (event: React.ChangeEvent<FieldElement>) => void;
	onBlur?: (event: React.FocusEvent<FieldElement>) => void;
	onKeyDown?: (event: React.KeyboardEvent<FieldElement>) => void;
}

export const TextField = React.forwardRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, TextFieldProps>(function TextField(
	{ className, id, label, hint, error, multiline, minRows, select, children, onChange, onBlur, onKeyDown, ...props },
	ref,
) {
	const generatedId = React.useId();
	const inputId = id ?? `omega-field-${generatedId}`;
	const message = error ?? hint;
	const messageId = message ? `${inputId}-message` : undefined;
	const commonProps = {
		id: inputId,
		className: cn("omega-input", error && "omega-input-error", className),
		"aria-invalid": error ? true : undefined,
		"aria-describedby": messageId,
		name: props.name,
		value: props.value,
		defaultValue: props.defaultValue,
		placeholder: props.placeholder,
		disabled: props.disabled,
		readOnly: props.readOnly,
		required: props.required,
		autoFocus: props.autoFocus,
			autoComplete: props.autoComplete,
			inputMode: props.inputMode,
			min: props.min,
		max: props.max,
		step: props.step,
	};
	return <label className="omega-field" htmlFor={inputId}>
		{label ? <span className="omega-field-label">{label}</span> : null}
			{select ? <select ref={ref as React.Ref<HTMLSelectElement>} {...commonProps} onChange={onChange as React.ChangeEventHandler<HTMLSelectElement>} onBlur={onBlur as React.FocusEventHandler<HTMLSelectElement>} onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLSelectElement>}>{children}</select> : multiline ? <textarea ref={ref as React.Ref<HTMLTextAreaElement>} {...commonProps} rows={minRows} onChange={onChange as React.ChangeEventHandler<HTMLTextAreaElement>} onBlur={onBlur as React.FocusEventHandler<HTMLTextAreaElement>} onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLTextAreaElement>} /> : <input ref={ref as React.Ref<HTMLInputElement>} {...commonProps} type={props.type} onChange={onChange as React.ChangeEventHandler<HTMLInputElement>} onBlur={onBlur as React.FocusEventHandler<HTMLInputElement>} onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLInputElement>} />}
		{message ? <span id={messageId} className={cn("omega-field-message", error && "omega-field-message-error")}>{message}</span> : null}
	</label>;
});
