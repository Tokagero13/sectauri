//! keepass 0.13 integration: DTOs sent to the frontend and helpers that map
//! the crate's tree types (`GroupRef`/`EntryRef`) into serializable data.

use keepass::db::{fields, CustomDataValue, EntryId, EntryRef, GroupId, GroupRef};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Group colour lives in the group's KDBX custom data, so it travels with the vault
/// (other KeePass clients ignore it).
pub const COLOR_KEY: &str = "sectauri.color";

/// The only colours a group may carry (the UI offers exactly these).
pub const PALETTE: [&str; 10] = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7",
    "#ec4899", "#64748b",
];

/// A group node with its children — the shape the UI renders as a tree.
#[derive(Serialize)]
pub struct GroupDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub groups: Vec<GroupDto>,
    pub entries: Vec<EntrySummaryDto>,
}

/// Lightweight entry row for the list and search (no password).
#[derive(Serialize)]
pub struct EntrySummaryDto {
    pub id: String,
    pub title: String,
    pub username: String,
    pub url: String,
    pub tags: Vec<String>,
    /// Last modification, Unix seconds (UTC); `None` when the vault never recorded one.
    pub modified: Option<i64>,
}

/// Full entry detail, including the (protected) password, for the edit form.
#[derive(Serialize)]
pub struct EntryDetailDto {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    /// Any non-standard fields, shown read-only so we never silently drop them.
    pub extra: Vec<ExtraFieldDto>,
}

#[derive(Serialize)]
pub struct ExtraFieldDto {
    pub key: String,
    pub value: String,
    pub protected: bool,
}

/// The editable fields the frontend sends back on create/update.
#[derive(Deserialize)]
pub struct EntryInput {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    /// User-defined fields beyond the standard five.
    #[serde(default)]
    pub custom: Vec<CustomFieldInput>,
}

#[derive(Deserialize)]
pub struct CustomFieldInput {
    pub key: String,
    pub value: String,
    pub protected: bool,
}

/// Ids are surfaced to the frontend as plain UUID strings.
pub fn parse_entry_id(s: &str) -> Result<EntryId, String> {
    Uuid::parse_str(s)
        .map(EntryId::from_uuid)
        .map_err(|_| "invalid entry id".to_string())
}

pub fn parse_group_id(s: &str) -> Result<GroupId, String> {
    Uuid::parse_str(s)
        .map(GroupId::from_uuid)
        .map_err(|_| "invalid group id".to_string())
}

fn field(entry: &EntryRef<'_>, key: &str) -> String {
    entry.get(key).unwrap_or("").to_string()
}

fn group_color(group: &GroupRef<'_>) -> Option<String> {
    match group.custom_data.get(COLOR_KEY)?.value.as_ref()? {
        CustomDataValue::String(c) if PALETTE.contains(&c.as_str()) => Some(c.clone()),
        _ => None,
    }
}

/// Recursively convert a group subtree into a `GroupDto`.
pub fn build_tree(group: GroupRef<'_>) -> GroupDto {
    GroupDto {
        id: group.id().uuid().to_string(),
        name: group.name.clone(),
        color: group_color(&group),
        groups: group.groups().map(build_tree).collect(),
        entries: group
            .entries()
            .map(|e| EntrySummaryDto {
                id: e.id().uuid().to_string(),
                title: field(&e, fields::TITLE),
                username: field(&e, fields::USERNAME),
                url: field(&e, fields::URL),
                tags: e.tags.clone(),
                modified: e.times.last_modification.map(|t| t.and_utc().timestamp()),
            })
            .collect(),
    }
}

/// Fields the app manages through dedicated inputs (or preserves as-is, like
/// OTP). Everything else is treated as a user-editable custom field.
const RESERVED_FIELDS: [&str; 6] = [
    fields::TITLE,
    fields::USERNAME,
    fields::PASSWORD,
    fields::URL,
    fields::NOTES,
    fields::OTP,
];

pub fn is_reserved(key: &str) -> bool {
    RESERVED_FIELDS.contains(&key)
}

pub fn entry_detail(entry: EntryRef<'_>) -> EntryDetailDto {
    let extra = entry
        .fields
        .iter()
        .filter(|(k, _)| !is_reserved(k))
        .map(|(k, v)| ExtraFieldDto {
            key: k.clone(),
            value: v.get().clone(),
            protected: v.is_protected(),
        })
        .collect();

    EntryDetailDto {
        id: entry.id().uuid().to_string(),
        title: field(&entry, fields::TITLE),
        username: field(&entry, fields::USERNAME),
        password: field(&entry, fields::PASSWORD),
        url: field(&entry, fields::URL),
        notes: field(&entry, fields::NOTES),
        extra,
    }
}
