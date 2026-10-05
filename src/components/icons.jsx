function Icon({ children, label }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} focusable="false">
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

export function DownloadIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M10 2.5a1 1 0 0 1 1 1V10l2.25-2.25a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42L9 10V3.5a1 1 0 0 1 1-1Zm-5 12a1 1 0 0 1 1 1v.5h8v-.5a1 1 0 1 1 2 0v1.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1.5a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function RemoveIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M7.5 2.5A1.5 1.5 0 0 0 6 4v.5H3.5a1 1 0 1 0 0 2h.56l.78 9.02A2.5 2.5 0 0 0 7.33 18h5.34a2.5 2.5 0 0 0 2.49-2.48l.78-9.02h.56a1 1 0 1 0 0-2H14V4a1.5 1.5 0 0 0-1.5-1.5h-5Zm4.5 2H8V4a.5.5 0 0 1 .5-.5h3A.5.5 0 0 1 12 4v.5Zm-3 4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function CopyIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M7 2.5A1.5 1.5 0 0 0 5.5 4v9A1.5 1.5 0 0 0 7 14.5h6A1.5 1.5 0 0 0 14.5 13V4A1.5 1.5 0 0 0 13 2.5H7Zm.5 2h5v8h-5v-8Zm-4 2A1.5 1.5 0 0 1 5 5v1.5h-.5v8h5V16a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5h-.5Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function OpenIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M11 2.5a1 1 0 0 0 0 2h2.09l-5.3 5.3a1 1 0 0 0 1.42 1.4l5.29-5.29V8a1 1 0 0 0 2 0V3.5a1 1 0 0 0-1-1H11ZM4.5 5A2 2 0 0 0 2.5 7v8.5a2 2 0 0 0 2 2H13a2 2 0 0 0 2-2V12a1 1 0 1 0-2 0v3.5H4.5V7H8a1 1 0 1 0 0-2H4.5Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function FolderIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h2.67a1.5 1.5 0 0 1 1.06.44l1.06 1.06H15.5A1.5 1.5 0 0 1 17 6v8.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-10Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function FileIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M5.5 2.5A1.5 1.5 0 0 0 4 4v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7.62a1.5 1.5 0 0 0-.44-1.06l-3.62-3.62A1.5 1.5 0 0 0 10.88 2.5H5.5ZM11 4.2 14.3 7.5H11V4.2Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function RenameIcon(props) {
  return (
    <Icon {...props}>
      <path
        d="M14.3 2.8a2 2 0 0 1 2.83 2.83l-.9.9-2.83-2.83.9-.9ZM12.1 5l2.83 2.83-7.3 7.3a1 1 0 0 1-.43.25l-3.3.95a.75.75 0 0 1-.93-.93l.95-3.3a1 1 0 0 1 .25-.43l7.93-7.67Z"
        fill="currentColor"
      />
    </Icon>
  );
}
