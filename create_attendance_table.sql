-- Attendance Table for Branch Schema
-- This table tracks daily attendance for students in classes

create table branch.attendance (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  student_id uuid not null,
  class_id uuid not null,
  teacher_id uuid not null,
  attendance_date date not null,
  status character varying(20) not null,
  subject character varying(100) null,
  remarks text null,
  academic_year character varying(20) not null,
  marked_at timestamp with time zone not null default timezone('utc'::text, now()),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint attendance_pkey primary key (id),
  constraint attendance_student_id_attendance_date_key unique (student_id, attendance_date),
  constraint attendance_branch_id_fkey foreign key (branch_id) references superadmin.branches(id) on delete CASCADE,
  constraint attendance_class_id_fkey foreign key (class_id) references branch.classes(id) on delete CASCADE,
  constraint attendance_student_id_fkey foreign key (student_id) references branch.students(id) on delete CASCADE,
  constraint attendance_teacher_id_fkey foreign key (teacher_id) references public.users(id) on delete CASCADE,
  constraint attendance_status_check check (
    status = any(array['Present', 'Absent', 'Late'])
  )
);

-- Create indexes for better query performance
create index if not exists idx_attendance_branch_id on branch.attendance using btree (branch_id);
create index if not exists idx_attendance_student_id on branch.attendance using btree (student_id);
create index if not exists idx_attendance_class_id on branch.attendance using btree (class_id);
create index if not exists idx_attendance_teacher_id on branch.attendance using btree (teacher_id);
create index if not exists idx_attendance_date on branch.attendance using btree (attendance_date);
create index if not exists idx_attendance_academic_year on branch.attendance using btree (academic_year);

-- Create composite indexes for common queries
create index if not exists idx_attendance_class_date on branch.attendance using btree (class_id, attendance_date);
create index if not exists idx_attendance_student_date on branch.attendance using btree (student_id, attendance_date);

-- Add RLS (Row Level Security) policies
alter table branch.attendance enable row level security;

-- Policy: Teachers can view attendance for their assigned classes
create policy "Teachers can view attendance for their classes" on branch.attendance
for select using (
  teacher_id = current_setting('app.current_user_id', true)::uuid
  or class_id in (
    select id from branch.classes 
    where teacher_id = current_setting('app.current_user_id', true)::uuid
  )
);

-- Policy: Teachers can insert attendance for their classes
create policy "Teachers can insert attendance for their classes" on branch.attendance
for insert with check (
  teacher_id = current_setting('app.current_user_id', true)::uuid
  and class_id in (
    select id from branch.classes 
    where teacher_id = current_setting('app.current_user_id', true)::uuid
  )
);

-- Policy: Teachers can update attendance for their classes
create policy "Teachers can update attendance for their classes" on branch.attendance
for update using (
  teacher_id = current_setting('app.current_user_id', true)::uuid
  and class_id in (
    select id from branch.classes 
    where teacher_id = current_setting('app.current_user_id', true)::uuid
  )
);

-- Policy: Admins can view all attendance in their branch
create policy "Admins can view all attendance in branch" on branch.attendance
for select using (
  branch_id = current_setting('app.current_branch_id', true)::uuid
  and exists (
    select 1 from public.users 
    where id = current_setting('app.current_user_id', true)::uuid 
    and role in ('admin', 'superadmin')
  )
);

-- Policy: Admins can insert all attendance in their branch
create policy "Admins can insert all attendance in branch" on branch.attendance
for insert with check (
  branch_id = current_setting('app.current_branch_id', true)::uuid
  and exists (
    select 1 from public.users 
    where id = current_setting('app.current_user_id', true)::uuid 
    and role in ('admin', 'superadmin')
  )
);

-- Policy: Admins can update all attendance in their branch
create policy "Admins can update all attendance in branch" on branch.attendance
for update using (
  branch_id = current_setting('app.current_branch_id', true)::uuid
  and exists (
    select 1 from public.users 
    where id = current_setting('app.current_user_id', true)::uuid 
    and role in ('admin', 'superadmin')
  )
);

-- Update trigger for updated_at column
create or replace function update_attendance_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

create trigger update_attendance_updated_at
before update on branch.attendance
for each row
execute function update_attendance_updated_at();