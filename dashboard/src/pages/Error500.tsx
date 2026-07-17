import ErrorPage from './ErrorPage';

export default function Error500() {
  return (
    <ErrorPage
      code={500}
      title="Something Went Wrong"
      message="Our servers hit an unexpected snag. Our team has been notified and is working on a fix."
    />
  );
}
