-- Create classes table in branch schema
CREATE TABLE IF NOT EXISTS branch.classes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  class_name character varying(50) NOT NULL,
  grade character varying(100) NULL,
  teacher_id uuid NULL,
  semester character varying(50) NULL,
  capacity integer NULL DEFAULT 30,
  room_number character varying(20) NULL,
  schedule text NULL,
  status character varying(20) NULL DEFAULT 'Active',
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  academic_year character varying(20) NOT NULL,
  standard character varying(50) NULL,
  CONSTRAINT classes_pkey PRIMARY KEY (id),
  CONSTRAINT unique_branch_class_name UNIQUE (branch_id, class_name),
  CONSTRAINT classes_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES superadmin.branches (id) ON DELETE CASCADE,
  CONSTRAINT classes_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users (id) ON DELETE SET NULL,
  CONSTRAINT classes_status_check CHECK (
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
CREATE INDEX IF NOT EXISTS idx_classes_branch_id ON branch.classes USING btree (branch_id);
CREATE INDEX IF NOT EXISTS idx_classes_teacher_id ON branch.classes USING btree (teacher_id);

-- Create trigger for updated_at column
CREATE TRIGGER update_classes_updated_at
  BEFORE UPDATE ON branch.classes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();