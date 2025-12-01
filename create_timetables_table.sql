-- Create timetables table in branch schema
CREATE TABLE IF NOT EXISTS branch.timetables (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  class_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  subject character varying(100) NOT NULL,
  day_of_week integer NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  room_number character varying(20) NULL,
  academic_year character varying(20) NOT NULL,
  semester character varying(50) NULL,
  status character varying(20) NULL DEFAULT 'Active',
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT timetables_pkey PRIMARY KEY (id),
  CONSTRAINT timetables_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES superadmin.branches (id) ON DELETE CASCADE,
  CONSTRAINT timetables_class_id_fkey FOREIGN KEY (class_id) REFERENCES branch.classes (id) ON DELETE CASCADE,
  CONSTRAINT timetables_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT timetables_day_of_week_check CHECK (
    (day_of_week >= 1) AND (day_of_week <= 7)
  ),
  CONSTRAINT timetables_status_check CHECK (
    (status)::text = ANY (
      (
        ARRAY[
          'Active'::character varying,
          'Inactive'::character varying
        ]
      )::text[]
    )
  )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_timetables_branch_id ON branch.timetables USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_timetables_class_id ON branch.timetables USING btree (class_id);
CREATE INDEX IF NOT EXISTS idx_timetables_teacher_id ON branch.timetables USING btree (teacher_id);

-- Create trigger for updated_at column
CREATE TRIGGER update_timetables_updated_at
  BEFORE UPDATE ON branch.timetables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();