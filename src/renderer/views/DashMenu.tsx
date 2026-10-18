import { Icon, MenuButton, type IconName } from '../ui';

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Client the item is for: its icon takes the client's colour, so two clients with the same icon still look apart. */
  client?: string;
  onSelect(): void;
}

/** Button with a list of actions; the shared MenuButton keeps the menu in the window, with arrow keys and Escape. */
export function DashMenu({ label, items, icon, iconOnly, className = '' }: { label: string; items: MenuItem[]; icon?: IconName; iconOnly?: boolean; className?: string }) {
  return (
    <MenuButton label={label} text={iconOnly ? undefined : label} icon={icon} className={className}>
      {close =>
        items.map(it => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              it.onSelect();
            }}
          >
            {it.icon &&
              (it.client ? (
                <span className={`dash-menu-ic c-${it.client}`}>
                  <Icon name={it.icon} />
                </span>
              ) : (
                <Icon name={it.icon} />
              ))}
            {it.label}
          </button>
        ))
      }
    </MenuButton>
  );
}
